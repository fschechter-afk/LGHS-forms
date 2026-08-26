import React, { useState } from 'react'
import { listForms, newForm, saveForm, deleteForm, getSettings, encodeForm, hubLink } from '../storage.js'

export default function Home() {
  const [forms, setForms] = useState(listForms())
  const [copied, setCopied] = useState(null)
  const [hubCopied, setHubCopied] = useState(false)
  const settings = getSettings()
  const studentLink = settings.sheetsEndpoint ? hubLink(settings.sheetsEndpoint) : ''

  async function copyStudentLink() {
    try {
      await navigator.clipboard.writeText(studentLink)
    } catch {
      prompt('Copy this link:', studentLink)
    }
    setHubCopied(true)
    setTimeout(() => setHubCopied(false), 1500)
  }

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
          <a className="btn ghost" href="#/chat">💬 LGHS Chatbox</a>
          <a className="btn ghost" href="#/settings">⚙ Sheets setup</a>
        </div>
      </header>

      {!settings.sheetsEndpoint && (
        <a className="banner" href="#/settings">
          Google Sheets isn't connected yet — responses will only be saved on this device.
          Tap to set up the automatic Sheets link.
        </a>
      )}

      {studentLink && (
        <div className="card student-link-card">
          <div className="card-title">📲 Student link — send this to the girls</div>
          <p className="muted small">
            One permanent link for everyone. Every form you publish to the hub shows
            up here, so you never have to send a new link. They can add it to their
            home screen and use it like an app.
          </p>
          <div className="student-link-url">{studentLink}</div>
          <div className="settings-actions">
            <button className="btn primary" onClick={copyStudentLink}>
              {hubCopied ? '✓ Copied' : 'Copy student link'}
            </button>
            <a className="btn" href={studentLink} target="_blank" rel="noreferrer">
              See what they see
            </a>
          </div>
        </div>
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
