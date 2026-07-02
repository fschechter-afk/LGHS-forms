import React, { useEffect, useState } from 'react'
import FillForm from './FillForm.jsx'
import { decodeText } from '../storage.js'
import { fetchHubForms } from '../sheets.js'

// Student-facing hub: one permanent link that lists every published form.
// The Sheets webhook URL is encoded in the hub link itself.
export default function Hub({ data }) {
  const endpoint = decodeText(data)
  const cacheKey = 'lghsforms.hubcache'
  const [state, setState] = useState('loading') // loading | ready | error
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
      // Offline or blocked: fall back to the last list this device saw.
      const cached = localStorage.getItem(cacheKey)
      if (cached) {
        try {
          setForms(JSON.parse(cached))
          setState('ready')
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

      {state === 'ready' && forms.length === 0 && (
        <div className="empty">
          <p>No forms are open right now.</p>
          <p className="muted small">Check back later, or tap Refresh.</p>
        </div>
      )}

      {state === 'ready' && forms.map((f) => (
        <div key={f.id} className="card form-card-hub" onClick={() => setActive(f)}>
          <div className="form-card-title">{f.title || 'Untitled form'}</div>
          {f.description && <div className="muted small">{f.description}</div>}
          <div className="hub-fill-hint">Tap to fill out →</div>
        </div>
      ))}
    </div>
  )
}
