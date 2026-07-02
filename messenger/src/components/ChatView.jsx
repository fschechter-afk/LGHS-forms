import React, { useEffect, useRef, useState } from 'react'
import { call, sendOrQueue } from '../api.js'
import { markRead, getOutbox } from '../storage.js'
import PollCard from './PollCard.jsx'

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '🙏', '✅']

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function fmtDay(ts) {
  const d = new Date(ts)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86400000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function ChatView({ channelId, session, quiet, onBack }) {
  const [channel, setChannel] = useState(null)
  const [messages, setMessages] = useState([])
  const [reactions, setReactions] = useState({})
  const [votes, setVotes] = useState({})
  const [canPost, setCanPost] = useState(true)
  const [error, setError] = useState('')
  const [text, setText] = useState('')
  const [pickerFor, setPickerFor] = useState(null)
  const [showPoll, setShowPoll] = useState(false)
  const [pollQuestion, setPollQuestion] = useState('')
  const [pollOptions, setPollOptions] = useState(['', ''])
  const [queuedCount, setQueuedCount] = useState(getOutbox().length)

  const sinceRef = useRef(0)
  const scrollRef = useRef(null)
  const stickToBottom = useRef(true)

  const refresh = async (full = false) => {
    const data = await call('getMessages', { channelId, since: full ? 0 : sinceRef.current })
    setChannel(data.channel)
    setCanPost(data.canPost)
    setReactions(data.reactions)
    setVotes(data.votes)
    if (data.messages.length > 0) {
      sinceRef.current = Math.max(sinceRef.current, ...data.messages.map((m) => m.createdAt))
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id))
        const merged = prev.concat(data.messages.filter((m) => !seen.has(m.id)))
        // Deletions arrive as a fresh copy of an already-seen message.
        const byId = new Map()
        merged.forEach((m) => byId.set(m.id, m))
        data.messages.forEach((m) => byId.set(m.id, m))
        return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt)
      })
    }
    markRead(channelId, data.now)
    setQueuedCount(getOutbox().length)
  }

  useEffect(() => {
    let cancelled = false
    refresh(true).catch((err) => !cancelled && setError(err.message))
    const timer = setInterval(() => {
      if (!document.hidden) refresh().catch(() => {})
    }, 4000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [channelId])

  // Keep the view pinned to the newest message unless the reader scrolled up.
  useEffect(() => {
    const el = scrollRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [messages])

  const onScroll = () => {
    const el = scrollRef.current
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  const send = async (e) => {
    e?.preventDefault()
    const body = text.trim()
    if (!body) return
    setText('')
    stickToBottom.current = true
    // Optimistic bubble; the poll refresh replaces it with the server copy.
    const temp = {
      id: 'temp_' + Date.now(),
      userId: session.user.id,
      userName: session.user.name,
      userRole: session.user.role,
      kind: 'text',
      text: body,
      data: null,
      createdAt: Date.now(),
      pending: true,
    }
    setMessages((prev) => [...prev, temp])
    try {
      const res = await sendOrQueue(channelId, { text: body })
      if (res.queued) setQueuedCount(getOutbox().length)
      await refresh()
      setMessages((prev) => prev.filter((m) => m.id !== temp.id))
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== temp.id))
      setError(err.message)
    }
  }

  const sendPoll = async (kind) => {
    const question = pollQuestion.trim()
    const options = pollOptions.map((o) => o.trim()).filter(Boolean)
    if (!question || (kind === 'poll' && options.length < 2)) return
    setShowPoll(false)
    setPollQuestion('')
    setPollOptions(['', ''])
    try {
      await call('send', { channelId, kind, text: question, options })
      await refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  const react = async (messageId, emoji) => {
    setPickerFor(null)
    try {
      await call('react', { messageId, emoji })
      await refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  const vote = async (messageId, choice) => {
    try {
      await call('vote', { messageId, choice })
      await refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  const remove = async (messageId) => {
    if (!confirm('Delete this message?')) return
    try {
      await call('deleteMessage', { messageId })
      await refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  const canModerate = session.user.role === 'admin' || session.user.role === 'faculty'
  const isFaculty = canModerate
  let lastDay = ''

  return (
    <div className="screen">
      <header className="topbar">
        <button className="icon-btn" onClick={onBack}>
          ←
        </button>
        <div className="topbar-title">
          <h1>{channel ? channel.name : '…'}</h1>
          {channel?.type === 'announcement' && (
            <span className="topbar-sub">Announcements · {canPost ? 'you can post' : 'read-only'}</span>
          )}
        </div>
      </header>

      {error && (
        <div className="error bar" onClick={() => setError('')}>
          {error} ✕
        </div>
      )}
      {queuedCount > 0 && (
        <div className="offline-bar">📡 {queuedCount} message{queuedCount > 1 ? 's' : ''} waiting to send…</div>
      )}

      <main className="messages" ref={scrollRef} onScroll={onScroll}>
        {messages.map((m) => {
          const day = fmtDay(m.createdAt)
          const divider = day !== lastDay ? <div className="day-divider" key={'d' + m.id}>{day}</div> : null
          lastDay = day
          const mine = m.userId === session.user.id
          const msgReactions = reactions[m.id] || {}

          return (
            <React.Fragment key={m.id}>
              {divider}
              <div className={'bubble-row' + (mine ? ' mine' : '')}>
                <div
                  className={'bubble' + (m.pending ? ' pending' : '') + (m.kind === 'deleted' ? ' deleted' : '')}
                  onDoubleClick={() => m.kind !== 'deleted' && !m.pending && react(m.id, '👍')}
                >
                  {!mine && m.kind !== 'deleted' && (
                    <div className={'bubble-author role-' + m.userRole}>
                      {m.userName}
                      {m.userRole !== 'student' && <span className="role-tag">{m.userRole}</span>}
                    </div>
                  )}
                  {m.kind === 'deleted' ? (
                    <em>Message deleted</em>
                  ) : m.kind === 'poll' || m.kind === 'checkin' ? (
                    <PollCard message={m} votes={votes[m.id]} onVote={(choice) => vote(m.id, choice)} />
                  ) : (
                    <div className="bubble-text">{m.text}</div>
                  )}
                  <div className="bubble-meta">
                    {m.pending ? '🕓' : fmtTime(m.createdAt)}
                    {m.kind !== 'deleted' && !m.pending && (
                      <>
                        <button className="meta-btn" title="React" onClick={() => setPickerFor(pickerFor === m.id ? null : m.id)}>
                          🙂+
                        </button>
                        {(mine || canModerate) && (
                          <button className="meta-btn" title="Delete" onClick={() => remove(m.id)}>
                            🗑
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  {pickerFor === m.id && (
                    <div className="reaction-picker">
                      {QUICK_REACTIONS.map((e) => (
                        <button key={e} onClick={() => react(m.id, e)}>
                          {e}
                        </button>
                      ))}
                    </div>
                  )}
                  {Object.keys(msgReactions).length > 0 && (
                    <div className="reaction-chips">
                      {Object.entries(msgReactions).map(([emoji, info]) => (
                        <button
                          key={emoji}
                          className={'reaction-chip' + (info.mine ? ' mine' : '')}
                          title={info.names.join(', ')}
                          onClick={() => react(m.id, emoji)}
                        >
                          {emoji} {info.count}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </React.Fragment>
          )
        })}
        {messages.length === 0 && <div className="empty">No messages yet. Say hi! 👋</div>}
      </main>

      {showPoll && (
        <div className="poll-composer">
          <div className="poll-composer-head">
            <strong>New poll</strong>
            <button className="icon-btn" onClick={() => setShowPoll(false)}>
              ✕
            </button>
          </div>
          <input
            placeholder="Question (e.g. Movie night pick?)"
            value={pollQuestion}
            onChange={(e) => setPollQuestion(e.target.value)}
          />
          {pollOptions.map((opt, i) => (
            <input
              key={i}
              placeholder={'Option ' + (i + 1)}
              value={opt}
              onChange={(e) =>
                setPollOptions((prev) => prev.map((o, j) => (j === i ? e.target.value : o)))
              }
            />
          ))}
          <div className="poll-composer-actions">
            <button className="btn-secondary" onClick={() => setPollOptions((p) => [...p, ''])} disabled={pollOptions.length >= 8}>
              ＋ Option
            </button>
            <button className="btn-primary" onClick={() => sendPoll('poll')}>
              Send poll
            </button>
            {isFaculty && (
              <button className="btn-secondary" title="One-tap roll call" onClick={() => sendPoll('checkin')}>
                🙋 Send as check-in
              </button>
            )}
          </div>
        </div>
      )}

      {canPost ? (
        <form className="composer" onSubmit={send}>
          <button type="button" className="icon-btn" title="Create a poll" onClick={() => setShowPoll((v) => !v)}>
            📊
          </button>
          <input
            placeholder={quiet ? 'Quiet hours — keep it low-key…' : 'Message'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={2000}
          />
          <button type="submit" className="send-btn" disabled={!text.trim()}>
            ➤
          </button>
        </form>
      ) : (
        <div className="composer readonly">Only faculty and admins can post here. You can still react and vote.</div>
      )}
    </div>
  )
}
