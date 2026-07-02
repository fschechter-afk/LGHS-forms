import React, { useEffect, useMemo, useState } from 'react'
import { call } from '../api.js'

export default function NewChat({ session, onBack }) {
  const [users, setUsers] = useState(null)
  const [error, setError] = useState('')
  const [mode, setMode] = useState('dm') // 'dm' | 'group'
  const [selected, setSelected] = useState([])
  const [groupName, setGroupName] = useState('')
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    call('directory')
      .then((data) => setUsers(data.users.filter((u) => u.id !== session.user.id)))
      .catch((err) => setError(err.message))
  }, [])

  const visible = useMemo(() => {
    if (!users) return []
    const q = filter.trim().toLowerCase()
    return q ? users.filter((u) => u.name.toLowerCase().includes(q)) : users
  }, [users, filter])

  const toggle = async (user) => {
    if (mode === 'dm') {
      setBusy(true)
      try {
        const data = await call('createChannel', { type: 'dm', memberIds: [user.id] })
        window.location.hash = 'chat/' + data.channelId
      } catch (err) {
        setError(err.message)
        setBusy(false)
      }
      return
    }
    setSelected((prev) =>
      prev.includes(user.id) ? prev.filter((id) => id !== user.id) : [...prev, user.id]
    )
  }

  const createGroup = async () => {
    if (!groupName.trim() || selected.length === 0) return
    setBusy(true)
    try {
      const data = await call('createChannel', { type: 'group', name: groupName, memberIds: selected })
      window.location.hash = 'chat/' + data.channelId
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="screen">
      <header className="topbar">
        <button className="icon-btn" onClick={onBack}>
          ←
        </button>
        <div className="topbar-title">
          <h1>New chat</h1>
        </div>
      </header>

      <div className="segmented">
        <button className={mode === 'dm' ? 'active' : ''} onClick={() => setMode('dm')}>
          Direct message
        </button>
        <button className={mode === 'group' ? 'active' : ''} onClick={() => setMode('group')}>
          Group
        </button>
      </div>

      {mode === 'group' && (
        <div className="group-setup">
          <input
            placeholder="Group name (e.g. Floor 2, Chess Club)"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            maxLength={60}
          />
          <button
            className="btn-primary"
            onClick={createGroup}
            disabled={busy || !groupName.trim() || selected.length === 0}
          >
            Create ({selected.length})
          </button>
        </div>
      )}

      <div className="search-box">
        <input placeholder="Search people…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>

      <main className="chat-list">
        {error && <div className="error">{error}</div>}
        {users === null && !error && <div className="empty">Loading directory…</div>}
        {visible.map((u) => (
          <button key={u.id} className="chat-row" disabled={busy} onClick={() => toggle(u)}>
            <div className="chat-avatar">{u.role === 'faculty' ? '🎓' : u.role === 'admin' ? '🛡️' : '🙂'}</div>
            <div className="chat-row-main">
              <div className="chat-row-top">
                <span className="chat-name">{u.name}</span>
              </div>
              <div className="chat-preview">{u.role}</div>
            </div>
            {mode === 'group' && (
              <span className="check">{selected.includes(u.id) ? '☑' : '☐'}</span>
            )}
          </button>
        ))}
        {users && visible.length === 0 && <div className="empty">No one matches that search.</div>}
      </main>
    </div>
  )
}
