import React, { useEffect, useState } from 'react'
import { call } from '../api.js'
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
    const timer = setInterval(() => {
      if (!document.hidden) refresh()
    }, 8000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  const lastRead = getLastRead()
  const isAdmin = session.user.role === 'admin'

  return (
    <div className="screen">
      <header className="topbar">
        <div className="topbar-title">
          <h1>LJHS Messenger</h1>
          <span className="topbar-sub">
            {session.user.name} · {session.user.role}
          </span>
        </div>
        <div className="topbar-actions">
          {isAdmin && (
            <button className="icon-btn" title="Admin panel" onClick={() => (window.location.hash = 'admin')}>
              ⚙️
            </button>
          )}
          <button className="icon-btn" title="Sign out" onClick={onSignOut}>
            ↩
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
