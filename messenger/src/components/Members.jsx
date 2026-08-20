import React, { useEffect, useState } from 'react'
import { call } from '../api.js'
import { personColor, initials } from '../people.js'

const ROLE_ICON = { staff: '🎓', admin: '🛡️', parent: '🏠', student: '🙂' }

// Who is in a group, and — for the creator, staff and admins — adding or
// removing people after the group already exists.
export default function Members({ channelId, session, onBack }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [adding, setAdding] = useState(false)
  const [picked, setPicked] = useState([])
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = async () => {
    try {
      setData(await call('channelMembers', { channelId }))
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    refresh()
  }, [channelId])

  const addPicked = async () => {
    if (!picked.length) return
    setBusy(true)
    try {
      const res = await call('addMembers', { channelId, memberIds: picked })
      setNotice(res.added === 1 ? '1 person added.' : res.added + ' people added.')
      setPicked([])
      setAdding(false)
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (person) => {
    if (!confirm('Remove ' + person.name + ' from this group?')) return
    try {
      await call('removeMember', { channelId, userId: person.id })
      await refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  const leave = async () => {
    if (!confirm('Leave this group? You will stop seeing its messages.')) return
    try {
      await call('leaveChannel', { channelId })
      window.location.hash = ''
    } catch (err) {
      setError(err.message)
    }
  }

  const q = filter.trim().toLowerCase()
  const candidates = (data?.others || []).filter((p) => !q || p.name.toLowerCase().includes(q))

  return (
    <div className="screen">
      <header className="topbar">
        <button className="icon-btn" onClick={onBack}>
          ←
        </button>
        <div className="topbar-title">
          <h1>{data?.channel?.name || 'Group'}</h1>
          <span className="topbar-sub">
            {data ? data.members.length + ' member' + (data.members.length === 1 ? '' : 's') : '…'}
          </span>
        </div>
      </header>

      <main className="admin">
        {error && (
          <div className="error bar" onClick={() => setError('')}>
            {error} ✕
          </div>
        )}
        {notice && (
          <div className="notice" onClick={() => setNotice('')}>
            {notice} ✕
          </div>
        )}

        {data?.canManage && !adding && (
          <button className="btn-primary" onClick={() => setAdding(true)}>
            ＋ Add people
          </button>
        )}

        {adding && (
          <section className="admin-card">
            <h2>Add people</h2>
            <div className="search-box" style={{ padding: '0 0 10px' }}>
              <input placeholder="Search people…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
            {candidates.length === 0 && <p className="hint">Everyone is already in this group.</p>}
            {candidates.map((p) => (
              <button
                key={p.id}
                className="chat-row"
                onClick={() =>
                  setPicked((prev) => (prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id]))
                }
              >
                <div className="chat-avatar" style={{ color: personColor(p.id) }}>
                  {initials(p.name)}
                </div>
                <div className="chat-row-main">
                  <div className="chat-row-top">
                    <span className="chat-name">{p.name}</span>
                  </div>
                  <div className="chat-preview">{p.role}</div>
                </div>
                <span className="check">{picked.includes(p.id) ? '☑' : '☐'}</span>
              </button>
            ))}
            <div className="poll-composer-actions" style={{ marginTop: 12 }}>
              <button className="btn-primary" onClick={addPicked} disabled={busy || !picked.length}>
                Add ({picked.length})
              </button>
              <button
                className="btn-secondary"
                onClick={() => {
                  setAdding(false)
                  setPicked([])
                }}
              >
                Cancel
              </button>
            </div>
          </section>
        )}

        <section className="admin-card">
          <h2>In this group</h2>
          {!data && <p className="hint">Loading…</p>}
          {data?.members.map((p) => (
            <div key={p.id} className="chat-row" style={{ cursor: 'default' }}>
              <div className="chat-avatar" style={{ color: personColor(p.id) }}>
                {initials(p.name)}
              </div>
              <div className="chat-row-main">
                <div className="chat-row-top">
                  <span className="chat-name" style={{ color: personColor(p.id) }}>
                    {p.name}
                    {p.id === session.user.id && ' (you)'}
                  </span>
                </div>
                <div className="chat-preview">
                  {ROLE_ICON[p.role] || ''} {p.role}
                  {data.channel.created_by === p.id ? ' · created this group' : ''}
                </div>
              </div>
              {data.canManage && p.id !== session.user.id && (
                <button className="btn-danger" onClick={() => remove(p)}>
                  Remove
                </button>
              )}
            </div>
          ))}
        </section>

        {data?.channel?.type === 'group' && (
          <section className="admin-card">
            <h2>Leave</h2>
            <p className="hint">You will stop seeing this group's messages. Someone can add you back later.</p>
            <button className="btn-danger" onClick={leave}>
              Leave this group
            </button>
          </section>
        )}
      </main>
    </div>
  )
}
