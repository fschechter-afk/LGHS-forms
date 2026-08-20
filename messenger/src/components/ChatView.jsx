import React, { useEffect, useRef, useState } from 'react'
import { call, sendOrQueue, onChannelActivity, uploadAttachment } from '../api.js'
import { markRead, getOutbox } from '../storage.js'
import { compressImage, isImage, isPdf, MAX_UPLOAD_BYTES } from '../images.js'
import { personColor } from '../people.js'
import PollCard from './PollCard.jsx'
import ImageBubble from './ImageBubble.jsx'
import FileBubble from './FileBubble.jsx'

// One-line summary of a message, for the quote above a reply.
function snippet(m) {
  if (!m) return ''
  if (m.kind === 'image') return '📷 ' + (m.text || 'Photo')
  if (m.kind === 'file') return '📄 ' + (m.data?.name || 'Document')
  if (m.kind === 'poll') return '📊 ' + m.text
  if (m.kind === 'checkin') return '🙋 ' + m.text
  if (m.kind === 'deleted') return 'Message deleted'
  return m.text
}

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
  const [uploading, setUploading] = useState(false)
  const [lightbox, setLightbox] = useState(null)
  const [replyTo, setReplyTo] = useState(null)
  const [flash, setFlash] = useState(null)
  const fileRef = useRef(null)

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
    // Realtime delivers messages/reactions/votes instantly; the interval is
    // only a safety net in case the websocket can't connect.
    const unsubscribe = onChannelActivity(channelId, () => refresh().catch(() => {}))
    const timer = setInterval(() => {
      if (!document.hidden) refresh().catch(() => {})
    }, 20000)
    return () => {
      cancelled = true
      unsubscribe()
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
    const quoted = replyTo?.id || null
    setReplyTo(null)
    try {
      const res = await sendOrQueue(channelId, { text: body, replyTo: quoted })
      if (res.queued) setQueuedCount(getOutbox().length)
      await refresh()
      setMessages((prev) => prev.filter((m) => m.id !== temp.id))
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== temp.id))
      setError(err.message)
    }
  }

  // Photos are compressed on the device first; PDFs upload as-is. Either way
  // the file lands in the channel's folder and a message points at it, with
  // any caption already typed riding along.
  const sendAttachment = async (file) => {
    if (!file) return
    const image = isImage(file)
    if (!image && !isPdf(file)) {
      setError('Only photos and PDFs can be attached.')
      if (fileRef.current) fileRef.current.value = ''
      return
    }
    if (!image && file.size > MAX_UPLOAD_BYTES) {
      setError('That PDF is too large (max 10 MB).')
      if (fileRef.current) fileRef.current.value = ''
      return
    }

    setUploading(true)
    setError('')
    stickToBottom.current = true
    try {
      const caption = text.trim()
      if (image) {
        const { blob, width, height } = await compressImage(file)
        const path = await uploadAttachment(channelId, blob, 'jpg')
        setText('')
        await call('send', { channelId, kind: 'image', text: caption, path, w: width, h: height })
      } else {
        const path = await uploadAttachment(channelId, file, 'pdf')
        setText('')
        await call('send', {
          channelId,
          kind: 'file',
          text: caption,
          path,
          name: file.name,
          size: file.size,
        })
      }
      await refresh()
    } catch (err) {
      setError(err.message || 'Could not send that attachment.')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
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

  const canModerate = session.user.role === 'admin' || session.user.role === 'staff'
  const isStaff = canModerate
  const byId = Object.fromEntries(messages.map((m) => [m.id, m]))

  // Tapping a quote scrolls to the message it refers to and flashes it.
  const jumpTo = (id) => {
    const el = document.getElementById('msg-' + id)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setFlash(id)
    setTimeout(() => setFlash(null), 1200)
  }

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
                  id={'msg-' + m.id}
                  className={
                    'bubble' +
                    (m.pending ? ' pending' : '') +
                    (m.kind === 'deleted' ? ' deleted' : '') +
                    (flash === m.id ? ' flash' : '')
                  }
                  onDoubleClick={() => m.kind !== 'deleted' && !m.pending && react(m.id, '👍')}
                >
                  {/* DMs have only one other person, so the name is noise there. */}
                  {!mine && m.kind !== 'deleted' && channel?.type !== 'dm' && (
                    <div className="bubble-author" style={{ color: personColor(m.userId) }}>
                      {m.userName}
                      {m.userRole !== 'student' && <span className="role-tag">{m.userRole}</span>}
                    </div>
                  )}
                  {m.replyTo && byId[m.replyTo] && (
                    <button
                      className="reply-quote"
                      style={{ borderLeftColor: personColor(byId[m.replyTo].userId) }}
                      onClick={() => jumpTo(m.replyTo)}
                    >
                      <span className="reply-quote-who" style={{ color: personColor(byId[m.replyTo].userId) }}>
                        {byId[m.replyTo].userId === session.user.id ? 'You' : byId[m.replyTo].userName}
                      </span>
                      <span className="reply-quote-text">{snippet(byId[m.replyTo])}</span>
                    </button>
                  )}
                  {m.kind === 'deleted' ? (
                    <em>Message deleted</em>
                  ) : m.kind === 'image' ? (
                    <ImageBubble message={m} onOpen={setLightbox} />
                  ) : m.kind === 'file' ? (
                    <FileBubble message={m} />
                  ) : m.kind === 'poll' || m.kind === 'checkin' ? (
                    <PollCard message={m} votes={votes[m.id]} onVote={(choice) => vote(m.id, choice)} />
                  ) : (
                    <div className="bubble-text">{m.text}</div>
                  )}
                  <div className="bubble-meta">
                    {m.pending ? '🕓' : fmtTime(m.createdAt)}
                    {m.kind !== 'deleted' && !m.pending && (
                      <>
                        <button className="meta-btn" title="Reply" onClick={() => setReplyTo(m)}>
                          ↩
                        </button>
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
            {isStaff && (
              <button className="btn-secondary" title="One-tap roll call" onClick={() => sendPoll('checkin')}>
                🙋 Send as check-in
              </button>
            )}
          </div>
        </div>
      )}

      {uploading && <div className="offline-bar">📎 Sending attachment…</div>}

      {canPost && replyTo && (
        <div className="reply-bar">
          <div className="reply-bar-quote" style={{ borderLeftColor: personColor(replyTo.userId) }}>
            <span className="reply-quote-who" style={{ color: personColor(replyTo.userId) }}>
              Replying to {replyTo.userId === session.user.id ? 'yourself' : replyTo.userName}
            </span>
            <span className="reply-quote-text">{snippet(replyTo)}</span>
          </div>
          <button className="icon-btn" title="Cancel reply" onClick={() => setReplyTo(null)}>
            ✕
          </button>
        </div>
      )}

      {canPost ? (
        <form className="composer" onSubmit={send}>
          <button type="button" className="icon-btn" title="Create a poll" onClick={() => setShowPoll((v) => !v)}>
            📊
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Attach a photo, flyer or PDF"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            📎
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf,.pdf"
            hidden
            onChange={(e) => sendAttachment(e.target.files?.[0])}
          />
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
        <div className="composer readonly">Only staff and admins can post here. You can still react and vote.</div>
      )}

      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" />
          <button className="lightbox-close" aria-label="Close">✕</button>
        </div>
      )}
    </div>
  )
}
