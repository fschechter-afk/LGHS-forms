// Backup & sync to the school's Supabase project.
//
// Sign-in is "Sign in with Google" (or Microsoft) using the student's school
// account. After that, everything is automatic: changed notes are uploaded a
// moment after she stops typing, and notes from other devices (e.g. a new
// phone) are downloaded when the app opens or comes back to the foreground.

import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON_KEY, AUTH_PROVIDER, SCHOOL_EMAIL_DOMAIN } from './config.js'

export function makeClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      // The Messenger runs on the same web address and keeps its own
      // (anonymous) login under Supabase's default key. A separate key keeps
      // the two apps from signing each other out.
      storageKey: 'lghs-notes-auth',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  })
}

export function emailAllowed(email) {
  if (!SCHOOL_EMAIL_DOMAIN) return true
  return String(email || '').toLowerCase().endsWith('@' + SCHOOL_EMAIL_DOMAIN.toLowerCase())
}

export async function signIn(sb) {
  const redirectTo = location.origin + location.pathname
  const options = { redirectTo }
  if (AUTH_PROVIDER === 'google') {
    options.queryParams = { prompt: 'select_account' }
    // "hd" makes Google show only accounts from the school's Workspace.
    if (SCHOOL_EMAIL_DOMAIN) options.queryParams.hd = SCHOOL_EMAIL_DOMAIN
  } else {
    options.scopes = 'email'
    if (SCHOOL_EMAIL_DOMAIN) options.queryParams = { domain_hint: SCHOOL_EMAIL_DOMAIN }
  }
  const { error } = await sb.auth.signInWithOAuth({ provider: AUTH_PROVIDER, options })
  if (error) throw error
}

// ---------------------------------------------------------------- rows

function toRow(n) {
  return {
    id: n.id,
    title: n.title || '',
    body: JSON.stringify(n.blocks.map((b) => (b.type === 'check' ? { type: 'check', text: b.text, done: !!b.done } : { type: 'text', text: b.text }))),
    created_at: n.createdAt,
    updated_at: n.updatedAt,
    deleted: !!n.deleted,
  }
}

let seq = 0
const bid = () => 'b' + Date.now().toString(36) + (seq++).toString(36)

function fromRow(r) {
  let blocks
  try {
    blocks = JSON.parse(r.body)
    if (!Array.isArray(blocks)) throw 0
    blocks = blocks.map((b) =>
      b.type === 'check'
        ? { id: bid(), type: 'check', text: String(b.text || ''), done: !!b.done }
        : { id: bid(), type: 'text', text: String(b.text || '') }
    )
  } catch {
    blocks = [{ id: bid(), type: 'text', text: String(r.body || '') }]
  }
  if (!blocks.length) blocks = [{ id: bid(), type: 'text', text: '' }]
  return {
    id: r.id,
    title: r.title || '',
    blocks,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    deleted: !!r.deleted,
  }
}

// ---------------------------------------------------------------- syncer

// Status values: 'synced' | 'pending' | 'syncing' | 'offline' | 'error'
//                | 'signin' (session expired) | 'denied' (not a school account)
export function createSyncer(sb, store, onStatus) {
  let status = ''
  let busy = false
  let again = false
  let wantPull = true
  let retryMs = 2000
  let pushTimer = null
  let retryTimer = null
  let pollTimer = null
  let stopped = false

  const set = (s) => {
    if (s !== status) {
      status = s
      onStatus(s)
    }
  }

  function settle() {
    set(store.dirtyIds().length ? 'pending' : 'synced')
  }

  async function pushAll() {
    const ids = store.dirtyIds()
    for (let i = 0; i < ids.length; i += 50) {
      const rows = ids
        .slice(i, i + 50)
        .map((id) => store.get(id))
        .filter(Boolean)
        .map(toRow)
      if (!rows.length) continue
      const { error } = await sb.rpc('save_notes', { items: rows })
      if (error) throw error
      rows.forEach((r) => store.markClean(r.id, r.updated_at))
    }
  }

  async function pullAll() {
    // Re-read a few seconds of overlap each time: applying a note twice is
    // harmless, missing one is not.
    let after = store.cursor ? new Date(new Date(store.cursor).getTime() - 10000).toISOString() : null
    for (;;) {
      let q = sb
        .from('notes')
        .select('id,title,body,created_at,updated_at,deleted,synced_at')
        .order('synced_at', { ascending: true })
        .limit(200)
      if (after) q = q.gt('synced_at', after)
      const { data, error } = await q
      if (error) throw error
      for (const r of data) store.applyRemote(fromRow(r))
      if (data.length) {
        after = data[data.length - 1].synced_at
        store.cursor = after
      }
      if (data.length < 200) break
    }
  }

  function classify(err) {
    const msg = String(err?.message || err || '')
    if (/school account/i.test(msg)) return 'denied'
    if (err?.status === 401 || /JWT|refresh token|not authenticated/i.test(msg)) return 'signin'
    if (!navigator.onLine || /fetch|network|load failed/i.test(msg)) return 'offline'
    return 'error'
  }

  async function run() {
    if (stopped) return
    if (busy) {
      again = true
      return
    }
    busy = true
    clearTimeout(retryTimer)
    try {
      do {
        again = false
        const { data, error } = await sb.auth.getSession()
        if (error) throw error
        if (!data.session) {
          set('signin')
          return
        }
        if (store.dirtyIds().length || wantPull) set('syncing')
        await pushAll()
        if (wantPull) {
          wantPull = false
          await pullAll()
        }
      } while (again && !stopped)
      retryMs = 2000
      settle()
    } catch (err) {
      const kind = classify(err)
      set(kind)
      if (kind !== 'denied' && kind !== 'signin') {
        retryTimer = setTimeout(run, retryMs)
        retryMs = Math.min(retryMs * 2, 60000)
      }
    } finally {
      busy = false
    }
  }

  const pull = () => {
    wantPull = true
    run()
  }

  const offStore = store.on((type) => {
    if (type !== 'local') return
    if (status === 'synced') set('pending')
    clearTimeout(pushTimer)
    pushTimer = setTimeout(run, 1500)
  })

  const onVisibility = () => {
    if (document.visibilityState === 'visible') pull()
    else run() // push anything outstanding before the app is suspended
  }
  const onOnline = () => pull()
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('online', onOnline)
  pollTimer = setInterval(() => document.visibilityState === 'visible' && pull(), 30000)

  pull()

  return {
    get status() {
      return status
    },
    syncNow: pull,
    // Upload everything still pending, e.g. before signing out.
    async flush() {
      await pushAll()
    },
    stop() {
      stopped = true
      offStore()
      clearTimeout(pushTimer)
      clearTimeout(retryTimer)
      clearInterval(pollTimer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('online', onOnline)
    },
  }
}
