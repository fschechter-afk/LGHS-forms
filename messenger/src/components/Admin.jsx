import React, { useEffect, useState } from 'react'
import { call } from '../api.js'
import { getSession, setSession as persistSession } from '../storage.js'
import { parseQuietHours } from '../quietHours.js'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js'

// Everything an admin needs day to day: invite codes (+ shareable join
// links), user management, and dorm-wide settings like quiet hours.
export default function Admin({ session, onSettingsChanged, onBack }) {
  const [codes, setCodes] = useState([])
  const [users, setUsers] = useState([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [codeRole, setCodeRole] = useState('student')
  const [codeCount, setCodeCount] = useState(5)
  const [codeShared, setCodeShared] = useState(true)
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
    const shared = codeShared && codeRole !== 'admin'
    try {
      const data = await call('admin', { op: 'createCodes', role: codeRole, count: codeCount, shared })
      setNotice(
        shared
          ? 'Shared ' + codeRole + ' code created: ' + data.codes[0] + ' — everyone can use it.'
          : 'Created ' + data.codes.length + ' single-use code(s): ' + data.codes.join(', ')
      )
      refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const revokeCode = async (code) => {
    if (!confirm('Revoke code ' + code.code + '? Nobody new can join with it (current members keep access).')) return
    try {
      await call('admin', { op: 'deleteCode', code: code.code })
      refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  const removeUser = async (user) => {
    if (!confirm('Remove ' + user.name + ' completely? Their account AND all their messages are deleted. Use Disable instead to block them but keep their messages.')) return
    try {
      await call('admin', { op: 'removeUser', userId: user.id })
      refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  const joinLink = (code) => {
    // When the app is built with its Supabase config baked in, links only
    // need to carry the code — much shorter and nicer to send.
    const baked = SUPABASE_URL === session.url && SUPABASE_ANON_KEY === session.key
    const payload = btoa(JSON.stringify(baked ? { c: code } : { u: session.url, k: session.key, c: code }))
    const base = window.location.href.split('#')[0]
    return base + '#join=' + encodeURIComponent(payload)
  }

  const copyLink = async (code) => {
    try {
      await navigator.clipboard.writeText(joinLink(code))
      setNotice('Join link for ' + code + ' copied.')
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

  const visibleCodes = codes.filter((c) => c.shared || !c.used)

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
          <p className="hint">
            A <strong>shared</strong> code can be used by everyone in that role (send one link to the
            whole group). Single-use codes admit one person each. Revoking a code stops new joins;
            people already in keep access.
          </p>
          <div className="admin-row">
            <select value={codeRole} onChange={(e) => setCodeRole(e.target.value)}>
              <option value="student">Student</option>
              <option value="parent">Parent</option>
              <option value="staff">Staff</option>
              <option value="admin">Admin</option>
            </select>
            {!(codeShared && codeRole !== 'admin') && (
              <input
                type="number"
                min="1"
                max="50"
                value={codeCount}
                onChange={(e) => setCodeCount(Number(e.target.value))}
              />
            )}
            <button className="btn-primary" onClick={makeCodes} disabled={busy}>
              Generate
            </button>
          </div>
          {codeRole !== 'admin' && (
            <label className="check-row">
              <input type="checkbox" checked={codeShared} onChange={(e) => setCodeShared(e.target.checked)} />
              Shared code (one code for the whole {codeRole} group)
            </label>
          )}
          {visibleCodes.length > 0 && (
            <ul className="code-list">
              {visibleCodes.map((c) => (
                <li key={c.code}>
                  <code>{c.code}</code>
                  <span className={'role-tag role-' + c.role}>{c.role}</span>
                  {c.shared && <span className="role-tag">shared · {c.uses} joined</span>}
                  <span className="code-actions">
                    <button className="btn-secondary" onClick={() => copyLink(c.code)}>
                      Copy link
                    </button>
                    <button className="btn-danger" onClick={() => revokeCode(c)}>
                      Revoke
                    </button>
                  </span>
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
                {u.id !== session.user.id && (
                  <span className="code-actions">
                    {u.status === 'active' ? (
                      <button className="btn-secondary" onClick={() => setStatus(u, 'disabled')}>
                        Disable
                      </button>
                    ) : (
                      <button className="btn-secondary" onClick={() => setStatus(u, 'active')}>
                        Re-enable
                      </button>
                    )}
                    <button className="btn-danger" onClick={() => removeUser(u)}>
                      Remove
                    </button>
                  </span>
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
            Announcement channels include everyone; only staff and admins can post in them.
          </p>
          <button className="btn-secondary" onClick={createAnnouncementChannel}>
            ＋ New announcement channel
          </button>
        </section>
      </main>
    </div>
  )
}
