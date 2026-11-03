import React, { useEffect, useState } from 'react'
import FillForm from './FillForm.jsx'
import NoteView from './NoteView.jsx'
import { decodeText, isNote } from '../storage.js'
import { fetchHubForms } from '../sheets.js'

// Student-facing hub: one permanent link that lists every published form.
// The Sheets webhook URL is encoded in the hub link itself.
export default function Hub({ data }) {
  const endpoint = decodeText(data)
  const cacheKey = 'lghsforms.hubcache'
  const [state, setState] = useState('loading') // loading | ready | stale | error
  const [forms, setForms] = useState([])
  const [active, setActive] = useState(null)

  async function load() {
    setState('loading')
    try {
      const list = await fetchHubForms(endpoint)
      const open = list.filter((f) => f.accepting !== false)
      setForms(open)
      setState('ready')
      localStorage.setItem(cacheKey, JSON.stringify(open))
    } catch {
      // Offline or blocked: show the last list this device saw, but say so —
      // otherwise an out-of-date list is indistinguishable from a current one.
      const cached = localStorage.getItem(cacheKey)
      if (cached) {
        try {
          setForms(JSON.parse(cached))
          setState('stale')
          return
        } catch {}
      }
      setState('error')
    }
  }

  useEffect(() => {
    if (endpoint) load()
  }, [])

  if (!endpoint) {
    return (
      <div className="page fill-page">
        <div className="card">
          <p>This hub link is invalid. Ask for a new one.</p>
        </div>
      </div>
    )
  }

  if (active) {
    if (isNote(active)) {
      return <NoteView note={active} onBack={() => setActive(null)} />
    }
    return <FillForm form={active} endpoint={endpoint} shared onBack={() => setActive(null)} />
  }

  return (
    <div className="page fill-page">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">LGHS</span> Forms
        </div>
        <button className="btn ghost" onClick={load}>↻ Refresh</button>
      </header>

      {state === 'loading' && <div className="empty"><p>Loading forms…</p></div>}

      {state === 'error' && (
        <div className="card">
          <p>Couldn't load the forms right now.</p>
          <p className="muted small">Check your connection, then tap Refresh.</p>
          <button className="btn primary" onClick={load}>Try again</button>
        </div>
      )}

      {state === 'stale' && (
        <div className="banner static">
          Couldn't reach the server, so this is the list from last time — anything
          added since is missing. Tap ↻ Refresh when you're back online.
        </div>
      )}

      {(state === 'ready' || state === 'stale') && forms.length === 0 && (
        <div className="empty">
          <p>No forms are open right now.</p>
          <p className="muted small">Check back later, or tap Refresh.</p>
        </div>
      )}

      <a className="card form-card-hub chat-hub-card" href={`#/chat/${data}`}>
        <div className="form-card-title">💬 LGHS Chatbox</div>
        <div className="muted small">Ask questions about the student handbook and school info.</div>
        <div className="hub-fill-hint">Tap to ask →</div>
      </a>

      {(state === 'ready' || state === 'stale') && forms.map((f) => (
        <div key={f.id} className="card form-card-hub" onClick={() => setActive(f)}>
          <div className="form-card-title">
            {isNote(f) && <span className="kind-tag">Post</span>}
            {f.title || (isNote(f) ? 'Untitled post' : 'Untitled form')}
          </div>
          {isNote(f)
            ? <div className="muted small hub-card-intro">{f.body}</div>
            : f.description && <div className="muted small hub-card-intro">{f.description}</div>}
          <div className="hub-fill-hint">{isNote(f) ? 'Tap to read →' : 'Tap to fill out →'}</div>
        </div>
      ))}
    </div>
  )
}
