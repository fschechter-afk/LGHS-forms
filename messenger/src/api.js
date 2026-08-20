// Supabase-backed API. Keeps the same call(action, params) surface the
// components were built against, and adds realtime subscriptions so messages
// arrive instantly instead of on a polling interval.

import { createClient } from '@supabase/supabase-js'
import { getSession, getOutbox, setOutbox, pushOutbox, uid } from './storage.js'

let client = null
let clientKey = ''

export function supabase(url, key) {
  const session = getSession()
  const u = url || session?.url
  const k = key || session?.key
  if (!u || !k) {
    // Mid-join there's no stored session yet; reuse the client join() created.
    if (client) return client
    throw new Error('Not signed in')
  }
  if (!client || clientKey !== u + k) {
    client = createClient(u, k)
    clientKey = u + k
  }
  return client
}

function fail(error) {
  const err = new Error(friendly(error.message) || 'Request failed')
  err.code = error.code || 'server'
  return err
}

// Postgres exceptions arrive as "P0001: message" style strings sometimes.
function friendly(message) {
  return String(message || '').replace(/^[A-Z0-9]{5}: /, '')
}

async function rpc(fn, args) {
  const { data, error } = await supabase().rpc(fn, args)
  if (error) throw fail(error)
  return data
}

async function select(query) {
  const { data, error } = await query
  if (error) throw fail(error)
  return data
}

const ts = (iso) => (iso ? new Date(iso).getTime() : 0)

// ---------------------------------------------------------------- join

export async function join(url, key, code, name) {
  const sb = supabase(url, key)
  // Identity is per-device: an anonymous auth user + a profile created by
  // redeeming the invite code. Reuse the existing auth user if one is stored.
  const { data: existing } = await sb.auth.getSession()
  if (!existing?.session) {
    const { error } = await sb.auth.signInAnonymously()
    if (error) throw fail(error)
  }
  const data = await rpc('redeem_invite', { p_code: code, p_name: name })
  return { url, key, user: data.user, settings: data.settings || {} }
}

// Moves an existing account onto this device using its personal restore
// code — the account's chats, messages and role come with it.
export async function restoreAccount(url, key, code) {
  const sb = supabase(url, key)
  const { data: existing } = await sb.auth.getSession()
  if (!existing?.session) {
    const { error } = await sb.auth.signInAnonymously()
    if (error) throw fail(error)
  }
  const data = await rpc('claim_recovery', { p_code: code })
  return { url, key, user: data.user, settings: data.settings || {} }
}

// Your own restore code. Never readable for anyone else.
export async function myRecoveryCode() {
  return rpc('my_recovery_code', {})
}

// Retires the current restore code and issues a new one, for when someone
// thinks theirs has been seen.
export async function regenerateRecoveryCode() {
  return rpc('regenerate_my_recovery_code', {})
}

// ---------------------------------------------------------------- actions

export async function call(action, params = {}) {
  switch (action) {
    case 'directory': {
      const rows = await select(
        supabase().from('profiles').select('id, name, role').eq('status', 'active').order('name')
      )
      return { ok: true, users: rows }
    }

    case 'listChannels': {
      const me = getSession().user.id
      const [channels, profiles] = await Promise.all([
        select(supabase().from('channels').select('*, channel_members(user_id)')),
        select(supabase().from('profiles').select('id, name')),
      ])
      const nameById = Object.fromEntries(profiles.map((p) => [p.id, p.name]))
      return {
        ok: true,
        channels: channels
          .map((ch) => {
            const members = (ch.channel_members || []).map((m) => m.user_id)
            let name = ch.name
            if (ch.type === 'dm') {
              const other = members.find((id) => id !== me)
              name = nameById[other] || 'Direct message'
            }
            return {
              id: ch.id,
              type: ch.type,
              name,
              lastMsgAt: ts(ch.last_msg_at),
              lastMsgPreview: ch.last_msg_preview || '',
              memberCount: ch.type === 'announcement' ? null : members.length,
            }
          })
          .sort((a, b) => b.lastMsgAt - a.lastMsgAt),
      }
    }

    case 'channelMembers': {
      const me = getSession().user
      const [channelRows, memberRows, profiles] = await Promise.all([
        select(supabase().from('channels').select('id, type, name, created_by').eq('id', params.channelId)),
        select(supabase().from('channel_members').select('user_id').eq('channel_id', params.channelId)),
        select(supabase().from('profiles').select('id, name, role').eq('status', 'active').order('name')),
      ])
      const channel = channelRows[0]
      if (!channel) throw Object.assign(new Error('Group not found'), { code: 'forbidden' })
      const memberIds = new Set(memberRows.map((m) => m.user_id))
      const canManage =
        channel.type === 'group' &&
        (channel.created_by === me.id || me.role === 'staff' || me.role === 'admin')
      return {
        ok: true,
        channel,
        canManage,
        members: profiles.filter((p) => memberIds.has(p.id)),
        others: profiles.filter((p) => !memberIds.has(p.id)),
      }
    }

    case 'addMembers': {
      const added = await rpc('add_channel_members', {
        p_channel: params.channelId,
        p_members: params.memberIds,
      })
      return { ok: true, added }
    }

    case 'removeMember':
      await rpc('remove_channel_member', { p_channel: params.channelId, p_user: params.userId })
      return { ok: true }

    case 'leaveChannel':
      await rpc('leave_channel', { p_channel: params.channelId })
      return { ok: true }

    case 'createChannel': {
      let channelId
      if (params.type === 'dm') channelId = await rpc('create_dm', { p_other: params.memberIds[0] })
      else if (params.type === 'announcement') channelId = await rpc('create_announcement', { p_name: params.name })
      else channelId = await rpc('create_group', { p_name: params.name, p_members: params.memberIds })
      return { ok: true, channelId }
    }

    case 'getMessages': {
      const me = getSession().user
      const since = params.since ? new Date(params.since).toISOString() : new Date(0).toISOString()
      // Author names come from a plain profiles fetch rather than a PostgREST
      // embed: embeds need exactly one foreign key between the two tables, and
      // that inference breaks as soon as the schema grows another link.
      const [channelRows, messages, reactionRows, voteRows, profiles] = await Promise.all([
        select(supabase().from('channels').select('id, type, name').eq('id', params.channelId)),
        select(
          supabase()
            .from('messages')
            .select('*')
            .eq('channel_id', params.channelId)
            .gt('created_at', since)
            .order('created_at')
        ),
        select(supabase().from('reactions').select('*').eq('channel_id', params.channelId)),
        select(supabase().from('votes').select('*').eq('channel_id', params.channelId)),
        select(supabase().from('profiles').select('id, name, role')),
      ])
      const channel = channelRows[0]
      if (!channel) throw Object.assign(new Error('Channel not found'), { code: 'forbidden' })

      const who = Object.fromEntries(profiles.map((p) => [p.id, p]))

      const reactions = {}
      for (const r of reactionRows) {
        const perMsg = (reactions[r.message_id] ||= {})
        const perEmoji = (perMsg[r.emoji] ||= { count: 0, mine: false, names: [] })
        perEmoji.count++
        perEmoji.names.push(who[r.user_id]?.name || '?')
        if (r.user_id === me.id) perEmoji.mine = true
      }

      const votes = {}
      for (const v of voteRows) {
        const perMsg = (votes[v.message_id] ||= { counts: {}, mine: null, voters: {} })
        perMsg.counts[v.choice] = (perMsg.counts[v.choice] || 0) + 1
        ;(perMsg.voters[v.choice] ||= []).push(who[v.user_id]?.name || '?')
        if (v.user_id === me.id) perMsg.mine = v.choice
      }

      const canPost =
        channel.type !== 'announcement' || me.role === 'admin' || me.role === 'staff'

      return {
        ok: true,
        canPost,
        channel,
        now: Date.now(),
        messages: messages.map((m) => ({
          id: m.id,
          userId: m.user_id,
          userName: who[m.user_id]?.name || '?',
          userRole: who[m.user_id]?.role || 'student',
          kind: m.kind,
          text: m.body,
          data: m.data,
          replyTo: m.reply_to || null,
          createdAt: ts(m.created_at),
        })),
        reactions,
        votes,
      }
    }

    case 'send': {
      const payload = params.options
        ? { options: params.options }
        : params.path
          ? params.kind === 'file'
            ? { path: params.path, name: params.name, size: params.size }
            : { path: params.path, w: params.w, h: params.h }
          : {}
      if (params.replyTo) payload.replyTo = params.replyTo
      const data = await rpc('send_message', {
        p_channel: params.channelId,
        p_kind: params.kind || 'text',
        p_body: params.text,
        p_data: payload,
      })
      return { ok: true, ...data }
    }

    case 'react':
      return { ok: true, ...(await rpc('toggle_reaction', { p_message: params.messageId, p_emoji: params.emoji })) }

    case 'vote':
      await rpc('set_vote', { p_message: params.messageId, p_choice: params.choice })
      return { ok: true }

    case 'deleteMessage':
      await rpc('delete_message', { p_message: params.messageId })
      return { ok: true }

    case 'admin':
      return adminCall(params)

    default:
      throw new Error('Unknown action: ' + action)
  }
}

async function adminCall(params) {
  switch (params.op) {
    case 'createCodes': {
      const codes = await rpc('admin_create_codes', {
        p_role: params.role,
        p_count: params.count,
        p_note: params.note || '',
        p_shared: !!params.shared,
      })
      return { ok: true, codes }
    }
    case 'listCodes': {
      const rows = await select(
        supabase()
          .from('invite_codes')
          .select('code, role, note, used_by, max_uses, use_count')
          .order('created_at', { ascending: false })
      )
      return {
        ok: true,
        codes: rows.map((c) => ({
          code: c.code,
          role: c.role,
          note: c.note,
          shared: c.max_uses === 0,
          uses: c.use_count || 0,
          used: c.max_uses > 0 && (c.use_count || 0) >= c.max_uses,
        })),
      }
    }
    case 'deleteCode':
      await rpc('admin_delete_code', { p_code: params.code })
      return { ok: true }
    case 'listUsers': {
      const rows = await select(supabase().from('profiles').select('id, name, role, status').order('name'))
      return { ok: true, users: rows }
    }
    case 'setUserStatus':
      await rpc('admin_set_status', { p_user: params.userId, p_status: params.status })
      return { ok: true }
    case 'removeUser':
      await rpc('admin_remove_user', { p_user: params.userId })
      return { ok: true }
    case 'setSetting': {
      const settings = await rpc('admin_set_setting', { p_key: params.key, p_value: params.value })
      return { ok: true, settings }
    }
    default:
      throw new Error('Unknown admin op')
  }
}

// ---------------------------------------------------------------- attachments

const BUCKET = 'attachments'

// Uploads into the channel's folder; the storage policies use that folder to
// decide who may read the file, and send_message re-checks it.
export async function uploadAttachment(channelId, blob, ext = 'jpg') {
  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`
  const path = `${channelId}/${name}`
  const { error } = await supabase().storage.from(BUCKET).upload(path, blob, {
    contentType: blob.type || 'application/octet-stream',
    upsert: false,
  })
  if (error) throw fail(error)
  return path
}

// The bucket is private, so images are shown through short-lived signed URLs.
// Cache them so re-renders and polling don't re-sign the same file.
const signed = new Map()

export async function signedImageUrl(path) {
  const hit = signed.get(path)
  if (hit && hit.expires > Date.now()) return hit.url
  const { data, error } = await supabase().storage.from(BUCKET).createSignedUrl(path, 3600)
  if (error) throw fail(error)
  signed.set(path, { url: data.signedUrl, expires: Date.now() + 3000 * 1000 })
  return data.signedUrl
}

// ---------------------------------------------------------------- realtime

// Calls onEvent whenever anything happens in the channel (new message,
// reaction, vote). Returns an unsubscribe function. If the websocket can't
// connect, the caller's fallback polling still covers us.
export function onChannelActivity(channelId, onEvent) {
  try {
    const sub = supabase()
      .channel('activity-' + channelId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: 'channel_id=eq.' + channelId }, onEvent)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reactions', filter: 'channel_id=eq.' + channelId }, onEvent)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'votes', filter: 'channel_id=eq.' + channelId }, onEvent)
      .subscribe()
    return () => supabase().removeChannel(sub)
  } catch {
    return () => {}
  }
}

// Fires when any channel row changes (new last message, new channel).
export function onChannelListActivity(onEvent) {
  try {
    const sub = supabase()
      .channel('channel-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'channels' }, onEvent)
      .subscribe()
    return () => supabase().removeChannel(sub)
  } catch {
    return () => {}
  }
}

// ---------------------------------------------------------------- offline outbox

export async function sendOrQueue(channelId, payload) {
  try {
    return await call('send', { channelId, ...payload })
  } catch (err) {
    // Server-side rejections (permissions etc.) shouldn't be retried blindly.
    if (err.code && err.code !== 'server') throw err
    if (navigator.onLine && err.code) throw err
    pushOutbox({ id: uid(), channelId, payload, queuedAt: Date.now() })
    return { queued: true }
  }
}

export async function flushOutbox() {
  const queue = getOutbox()
  if (!queue.length) return 0
  const remaining = []
  let sent = 0
  for (const item of queue) {
    try {
      await call('send', { channelId: item.channelId, ...item.payload })
      sent++
    } catch (err) {
      if (err.code && navigator.onLine) continue // rejected for real: drop it
      remaining.push(item)
    }
  }
  setOutbox(remaining)
  return sent
}
