import React, { useMemo, useState } from 'react'
import { join, restoreAccount } from '../api.js'
import { setSession } from '../storage.js'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js'

// Join links look like  #join=<base64 of {"c": code}>  when the app is
// configured (src/config.js), or carry "u" and "k" too when it isn't —
// either way an admin hands out a single link.
function decodeJoinPayload(payload) {
  try {
    return JSON.parse(atob(decodeURIComponent(payload)))
  } catch {
    return {}
  }
}

export default function Join({ joinPayload, joinCode, onJoined }) {
  const prefill = useMemo(() => {
    if (joinCode) return { c: joinCode.toUpperCase() } // plain ?code=STA-XXXX
    return joinPayload ? decodeJoinPayload(joinPayload) : {}
  }, [joinPayload, joinCode])
  const [url, setUrl] = useState(prefill.u || SUPABASE_URL || '')
  const [key, setKey] = useState(prefill.k || SUPABASE_ANON_KEY || '')
  const [code, setCode] = useState(prefill.c || '')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [restoring, setRestoring] = useState(false)
  const [restoreCode, setRestoreCode] = useState('')

  const manual = !(prefill.u || SUPABASE_URL) || !(prefill.k || SUPABASE_ANON_KEY)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    const projectUrl = url.trim().replace(/\/+$/, '')
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(projectUrl)) {
      setError('The project URL should look like https://abcdefgh.supabase.co')
      return
    }
    setBusy(true)
    try {
      const session = restoring
        ? await restoreAccount(projectUrl, key.trim(), restoreCode.trim())
        : await join(projectUrl, key.trim(), code.trim(), name.trim())
      setSession(session)
      onJoined(session)
    } catch (err) {
      setError(
        err.message ||
          (restoring ? 'Could not restore that account.' : 'Could not join. Check the code and try again.')
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="join-screen">
      <div className="join-card">
        <img className="join-logo" src="./logo-white-256.png" alt="LGHS" />
        <h1>LGHS School Messenger</h1>
        <p className="join-sub">
          Private, invite-only messaging for students, parents and staff. Ask your dorm admin for an invite
          code or a join link.
        </p>
        <form onSubmit={submit}>
          {manual && (
            <>
              <label>
                Supabase project URL
                <input
                  type="url"
                  placeholder="https://abcdefgh.supabase.co"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                />
              </label>
              <label>
                Supabase anon key
                <input
                  type="text"
                  placeholder="eyJhbGciOi…"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  autoComplete="off"
                  required
                />
              </label>
            </>
          )}
          {restoring ? (
            <label>
              Your restore code
              <input
                type="text"
                placeholder="LGHS-ABC123"
                value={restoreCode}
                onChange={(e) => setRestoreCode(e.target.value.toUpperCase())}
                autoCapitalize="characters"
                autoComplete="off"
                required
              />
            </label>
          ) : (
            <>
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
            </>
          )}
          {error && <div className="error">{error}</div>}
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? (restoring ? 'Restoring…' : 'Joining…') : restoring ? 'Restore my account' : 'Join'}
          </button>
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setRestoring((v) => !v)
              setError('')
            }}
          >
            {restoring ? '← Back to joining with an invite code' : 'Already had an account? Restore it'}
          </button>
        </form>
      </div>
    </div>
  )
}
