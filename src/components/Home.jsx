import React, { useState } from 'react'
import { listForms, newForm, newNote, saveForm, deleteForm, getSettings, encodeForm, encodeNote, hubLink, isNote } from '../storage.js'

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

  function createNote() {
    const note = saveForm(newNote())
    location.hash = `#/edit/${note.id}`
  }

  function remove(id) {
    if (!confirm('Delete this and its local responses?')) return
    deleteForm(id)
    setForms(listForms())
  }

  async function copyLink(form) {
    const url = isNote(form)
      ? `${location.origin}${location.pathname}#/read/${encodeNote(form)}`
      : `${location.origin}${location.pathname}#/fill/${encodeForm(form, settings.sheetsEndpoint)}`
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
        <div className="form-card-actions">
          <button className="btn" onClick={createNote}>+ New post</button>
          <button className="btn primary" onClick={create}>+ New form</button>
        </div>
      </div>

      {forms.length === 0 ? (
        <div className="empty">
          <p>Nothing yet.</p>
          <p className="muted">
            A <strong>form</strong> collects answers into your Google Sheet. A{' '}
            <strong>post</strong> is something to read — a farbrengen write-up or an
            announcement. Both appear in the girls' app when you publish them.
          </p>
        </div>
      ) : (
        <ul className="form-list">
          {forms.map((f) => (
            <li key={f.id} className="form-card">
              <div className="form-card-main" onClick={() => (location.hash = `#/edit/${f.id}`)}>
                <div className="form-card-title">
                  {isNote(f) && <span className="kind-tag">Post</span>}
                  {f.title || (isNote(f) ? 'Untitled post' : 'Untitled form')}
                </div>
                <div className="muted small">
                  {isNote(f)
                    ? `${(f.body || '').length.toLocaleString()} characters`
                    : `${f.questions.length} question${f.questions.length === 1 ? '' : 's'}`}
                  {' · '}updated {new Date(f.updatedAt).toLocaleDateString()}
                  {!f.accepting && (isNote(f) ? ' · hidden' : ' · closed')}
                </div>
              </div>
              <div className="form-card-actions">
                <button className="btn small" onClick={() => copyLink(f)}>
                  {copied === f.id ? '✓ Copied' : 'Share'}
                </button>
                <a className="btn small" href={isNote(f) ? `#/read-preview/${f.id}` : `#/preview/${f.id}`}>Preview</a>
                {!isNote(f) && <a className="btn small" href={`#/responses/${f.id}`}>Responses</a>}
                <button className="btn small danger" onClick={() => remove(f.id)}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
