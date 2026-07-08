import React, { useState } from 'react'
import { listForms, newForm, saveForm, deleteForm, getSettings, encodeForm } from '../storage.js'

export default function Home() {
  const [forms, setForms] = useState(listForms())
  const [copied, setCopied] = useState(null)
  const settings = getSettings()

  function create() {
    const form = saveForm(newForm())
    location.hash = `#/edit/${form.id}`
  }

  function remove(id) {
    if (!confirm('Delete this form and its local responses?')) return
    deleteForm(id)
    setForms(listForms())
  }

  async function copyLink(form) {
    const url = `${location.origin}${location.pathname}#/fill/${encodeForm(form, settings.sheetsEndpoint)}`
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      prompt('Copy this link:', url)
    }
    setCopied(form.id)
    setTimeout(() => setCopied(null), 1500)
  }

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">LGHS</span> Forms
        </div>
        <div className="topbar-actions">
          <a className="btn ghost" href="#/chat">📖 Handbook chat</a>
          <a className="btn ghost" href="#/settings">⚙ Sheets setup</a>
        </div>
      </header>

      {!settings.sheetsEndpoint && (
        <a className="banner" href="#/settings">
          Google Sheets isn't connected yet — responses will only be saved on this device.
          Tap to set up the automatic Sheets link.
        </a>
      )}

      <div className="page-head">
        <h1>Your forms</h1>
        <button className="btn primary" onClick={create}>+ New form</button>
      </div>

      {forms.length === 0 ? (
        <div className="empty">
          <p>No forms yet.</p>
          <p className="muted">Create a form, share the link, and responses land in your Google Sheet.</p>
        </div>
      ) : (
        <ul className="form-list">
          {forms.map((f) => (
            <li key={f.id} className="form-card">
              <div className="form-card-main" onClick={() => (location.hash = `#/edit/${f.id}`)}>
                <div className="form-card-title">{f.title || 'Untitled form'}</div>
                <div className="muted small">
                  {f.questions.length} question{f.questions.length === 1 ? '' : 's'} ·
                  {' '}updated {new Date(f.updatedAt).toLocaleDateString()}
                  {!f.accepting && ' · closed'}
                </div>
              </div>
              <div className="form-card-actions">
                <button className="btn small" onClick={() => copyLink(f)}>
                  {copied === f.id ? '✓ Copied' : 'Share'}
                </button>
                <a className="btn small" href={`#/preview/${f.id}`}>Preview</a>
                <a className="btn small" href={`#/responses/${f.id}`}>Responses</a>
                <button className="btn small danger" onClick={() => remove(f.id)}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
