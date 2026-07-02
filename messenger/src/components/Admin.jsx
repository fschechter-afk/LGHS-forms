import React, { useEffect, useState } from 'react'
import { call } from '../api.js'
import { getSession, setSession as persistSession } from '../storage.js'
import { parseQuietHours } from '../quietHours.js'

// Everything an admin needs day to day: invite codes (+ shareable join
// links), user management, and dorm-wide settings like quiet hours.
export default function Admin({ session, onSettingsChanged, onBack }) {
  const [codes, setCodes] = useState([])
  const [users, setUsers] = useState([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [codeRole, setCodeRole] = useState('student')
  const [codeCount, setCodeCount] = useState(5)
  const [quietHours, setQuietHours] = useState(session.settings?.quietHours || '')
  const [busy, setBusy] = useState(false)

  const refresh = async () => {
    try {
      const [c, u] = await Promise.all([call('admin', { op: 'listCodes' }), call('admin', { op: 'listUsers' })])
      setCodes(c.codes)
      setUsers(u.users)
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const makeCodes = async () => {
    setBusy(true)
    setError('')
    try {
      const data = await call('admin', { op: 'createCodes', role: codeRole, count: codeCount })
      setNotice('Created ' + data.codes.length + ' code(s): ' + data.codes.join(', '))
      refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const joinLink = (code) => {
    const payload = btoa(JSON.stringify({ api: session.apiUrl, code }))
    const base = window.location.href.split('#')[0]
    return base + '#join=' + encodeURIComponent(payload)
  }

  const copyLink = async (code) => {
    try {
      await navigator.clipboard.writeText(joinLink(code))
      setNotice('Join link for ' + code + ' copied — send it to one person.')
    } catch {
      prompt('Copy this join link:', joinLink(code))
    }
  }

  const setStatus = async (user, status) => {
    try {
      await call('admin', { op: 'setUserStatus', userId: user.id, status })
      refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  const saveQuietHours = async () => {
    const value = quietHours.trim()
    if (value && !parseQuietHours(value)) {
      setError('Quiet hours must look like 21:30-07:00 (or be empty to turn off).')
      return
    }
    setError('')
    try {
      const data = await call('admin', { op: 'setSetting', key: 'quietHours', value })
      const s = { ...getSession(), settings: data.settings }
      persistSession(s)
      onSettingsChanged(s)
      setNotice(value ? 'Quiet hours set to ' + value : 'Quiet hours turned off.')
    } catch (err) {
      setError(err.message)
    }
  }

  const createAnnouncementChannel = async () => {
    const name = prompt('Announcement channel name:', '📣 Dorm Announcements')
    if (!name) return
    try {
      const data = await call('createChannel', { type: 'announcement', name })
      window.location.hash = 'chat/' + data.channelId
    } catch (err) {
      setError(err.message)
    }
  }

  const unused = codes.filter((c) => !c.used)

  return (
    <div className="screen">
      <header className="topbar">
        <button className="icon-btn" onClick={onBack}>
          ←
        </button>
        <div className="topbar-title">
          <h1>Admin panel</h1>
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

        <section className="admin-card">
          <h2>Invite codes</h2>
          <p className="hint">Each code admits one person. Copy a join link and send it privately.</p>
          <div className="admin-row">
            <select value={codeRole} onChange={(e) => setCodeRole(e.target.value)}>
              <option value="student">Student</option>
              <option value="faculty">Faculty</option>
              <option value="admin">Admin</option>
            </select>
            <input
              type="number"
              min="1"
              max="50"
              value={codeCount}
              onChange={(e) => setCodeCount(Number(e.target.value))}
            />
            <button className="btn-primary" onClick={makeCodes} disabled={busy}>
              Generate
            </button>
          </div>
          {unused.length > 0 && (
            <ul className="code-list">
              {unused.map((c) => (
                <li key={c.code}>
                  <code>{c.code}</code>
                  <span className={'role-tag role-' + c.role}>{c.role}</span>
                  <button className="btn-secondary" onClick={() => copyLink(c.code)}>
                    Copy join link
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="admin-card">
          <h2>People ({users.filter((u) => u.status === 'active').length} active)</h2>
          <ul className="user-list">
            {users.map((u) => (
              <li key={u.id}>
                <span className="chat-name">{u.name}</span>
                <span className={'role-tag role-' + u.role}>{u.role}</span>
                {u.status === 'active' ? (
                  u.id !== session.user.id && (
                    <button className="btn-danger" onClick={() => setStatus(u, 'disabled')}>
                      Disable
                    </button>
                  )
                ) : (
                  <button className="btn-secondary" onClick={() => setStatus(u, 'active')}>
                    Re-enable
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="admin-card">
          <h2>Quiet hours</h2>
          <p className="hint">
            During this window the app shows a 🌙 banner and mutes notification sounds. Format:
            21:30-07:00.
          </p>
          <div className="admin-row">
            <input
              placeholder="21:30-07:00"
              value={quietHours}
              onChange={(e) => setQuietHours(e.target.value)}
            />
            <button className="btn-primary" onClick={saveQuietHours}>
              Save
            </button>
          </div>
        </section>

        <section className="admin-card">
          <h2>Channels</h2>
          <p className="hint">
            Announcement channels include everyone; only faculty and admins can post in them.
          </p>
          <button className="btn-secondary" onClick={createAnnouncementChannel}>
            ＋ New announcement channel
          </button>
        </section>
      </main>
    </div>
  )
}
