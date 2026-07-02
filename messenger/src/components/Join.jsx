import React, { useMemo, useState } from 'react'
import { rawCall } from '../api.js'
import { setSession } from '../storage.js'

// Join links look like  #join=<base64 of {"api": "...", "code": "..."}>
// so an admin can hand out a single link instead of two things to paste.
function decodeJoinPayload(payload) {
  try {
    return JSON.parse(atob(decodeURIComponent(payload)))
  } catch {
    return {}
  }
}

export default function Join({ joinPayload, onJoined }) {
  const prefill = useMemo(() => (joinPayload ? decodeJoinPayload(joinPayload) : {}), [joinPayload])
  const [apiUrl, setApiUrl] = useState(prefill.api || '')
  const [code, setCode] = useState(prefill.code || '')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    const url = apiUrl.trim()
    if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) {
      setError('The server link should be a Google Apps Script URL ending in /exec.')
      return
    }
    setBusy(true)
    try {
      const data = await rawCall(url, 'join', { code: code.trim(), name: name.trim() })
      const session = { apiUrl: url, token: data.token, user: data.user, settings: data.settings || {} }
      setSession(session)
      onJoined(session)
    } catch (err) {
      setError(err.message || 'Could not join. Check the code and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="join-screen">
      <div className="join-card">
        <div className="join-logo">💬</div>
        <h1>LJHS Dorm Messenger</h1>
        <p className="join-sub">
          Private, invite-only messaging for students and faculty. Ask your dorm admin for an invite
          code or a join link.
        </p>
        <form onSubmit={submit}>
          {!prefill.api && (
            <label>
              Server link
              <input
                type="url"
                placeholder="https://script.google.com/…/exec"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                required
              />
            </label>
          )}
          <label>
            Invite code
            <input
              type="text"
              placeholder="STU-ABC123"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              autoCapitalize="characters"
              autoComplete="off"
              required
            />
          </label>
          <label>
            Your name
            <input
              type="text"
              placeholder="First Last"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              required
            />
          </label>
          {error && <div className="error">{error}</div>}
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Joining…' : 'Join'}
          </button>
        </form>
      </div>
    </div>
  )
}
