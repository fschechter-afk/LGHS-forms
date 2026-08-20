import React, { useEffect, useState } from 'react'
import { call, onChannelListActivity, myRecoveryCode, regenerateRecoveryCode } from '../api.js'
import { getLastRead } from '../storage.js'

const CHANNEL_ICONS = { announcement: '📣', group: '👥', dm: '💬' }

function timeAgo(ts) {
  if (!ts) return ''
  const mins = Math.floor((Date.now() - ts) / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return mins + 'm'
  const hours = Math.floor(mins / 60)
  if (hours < 24) return hours + 'h'
  return Math.floor(hours / 24) + 'd'
}

export default function ChatList({ session, onSignOut }) {
  const [channels, setChannels] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      try {
        const data = await call('listChannels')
        if (!cancelled) {
          setChannels(data.channels)
          setError('')
        }
      } catch (err) {
        if (!cancelled && !channels) setError(err.message)
      }
    }
    refresh()
    // Realtime keeps the list fresh; the interval is a safety net in case
    // the websocket can't connect.
    const unsubscribe = onChannelListActivity(refresh)
    const timer = setInterval(() => {
      if (!document.hidden) refresh()
    }, 30000)
    return () => {
      cancelled = true
      unsubscribe()
      clearInterval(timer)
    }
  }, [])

  const lastRead = getLastRead()
  const isAdmin = session.user.role === 'admin'

  // Anonymous accounts live in one browser, so the restore code is the only
  // way back after a sign-out, a wipe, or a new phone. Make it easy to save.
  const showRestoreCode = async () => {
    try {
      // Always ask the server: a code stored at join time goes stale if it
      // was later regenerated on another device.
      const code = await myRecoveryCode()
      const msg =
        'Your restore code:\n\n' +
        code +
        '\n\nSave this somewhere safe. It is the only way to get this account — and its chats — back on a new phone or after signing out. Do not share it: anyone who has it can take over your account.'
      try {
        await navigator.clipboard.writeText(code)
        alert(msg + '\n\n(Copied to your clipboard.)')
      } catch {
        prompt(msg, code)
      }
      if (confirm('Need a new code instead? Tap OK to replace it — the old one stops working immediately.')) {
        const fresh = await regenerateRecoveryCode()
        try {
          await navigator.clipboard.writeText(fresh)
        } catch {
          // Clipboard unavailable; the code is still shown below.
        }
        alert('Your new restore code:\n\n' + fresh + '\n\nThe previous code no longer works.')
      }
    } catch (err) {
      alert('Could not load your restore code: ' + err.message)
    }
  }

  return (
    <div className="screen">
      <header className="topbar">
        <div className="topbar-title">
          <h1>LGHS School Messenger</h1>
          <button className="topbar-sub as-link" onClick={showRestoreCode}>
            {session.user.name} · {session.user.role} · 🔑 restore code
          </button>
        </div>
        <div className="topbar-actions">
          {isAdmin && (
            <button className="icon-btn" title="Admin panel" onClick={() => (window.location.hash = 'admin')}>
              ⚙️
            </button>
          )}
          <button
            className="signout-btn"
            title="Sign out"
            onClick={() => {
              if (confirm('Sign out? You will need a new invite code to get back in on this device.'))
                onSignOut()
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="chat-list">
        {error && <div className="error">{error}</div>}
        {channels === null && !error && <div className="empty">Loading chats…</div>}
        {channels && channels.length === 0 && (
          <div className="empty">
            No chats yet. Start one with the <strong>＋</strong> button.
          </div>
        )}
        {channels &&
          channels.map((ch) => {
            const unread = ch.lastMsgAt > (lastRead[ch.id] || 0) && ch.lastMsgPreview
            return (
              <button
                key={ch.id}
                className={'chat-row' + (unread ? ' unread' : '')}
                onClick={() => (window.location.hash = 'chat/' + ch.id)}
              >
                <div className="chat-avatar">{CHANNEL_ICONS[ch.type] || '💬'}</div>
                <div className="chat-row-main">
                  <div className="chat-row-top">
                    <span className="chat-name">{ch.name}</span>
                    <span className="chat-time">{timeAgo(ch.lastMsgAt)}</span>
                  </div>
                  <div className="chat-preview">{ch.lastMsgPreview || 'No messages yet'}</div>
                </div>
                {unread && <span className="unread-dot" />}
              </button>
            )
          })}
      </main>

      <button className="fab" title="New chat" onClick={() => (window.location.hash = 'new')}>
        ＋
      </button>
    </div>
  )
}
