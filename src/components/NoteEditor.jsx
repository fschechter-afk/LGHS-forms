import React, { useEffect, useRef, useState } from 'react'
import { getForm, saveForm, getSettings, encodeNote, NOTE_MAX_CHARS } from '../storage.js'
import { publishToHub, unpublishFromHub } from '../sheets.js'
import AutoGrowInput from './AutoGrowInput.jsx'

// Editor for a post: something the girls read rather than fill in.
// Paste from email or Word and the paragraphs come across as written.
export default function NoteEditor({ noteId }) {
  const [note, setNote] = useState(() => getForm(noteId))
  const [savedTick, setSavedTick] = useState(false)
  const [hubBusy, setHubBusy] = useState(false)
  const saveTimer = useRef(null)

  useEffect(() => {
    if (!note) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveForm(note)
      setSavedTick(true)
      setTimeout(() => setSavedTick(false), 1200)
    }, 400)
    return () => clearTimeout(saveTimer.current)
  }, [note])

  if (!note) {
    return (
      <div className="page">
        <p>Post not found. <a href="#/">Back to your forms</a></p>
      </div>
    )
  }

  const update = (patch) => setNote({ ...note, ...patch })
  const tooLong = (note.body || '').length > NOTE_MAX_CHARS

  async function copyLink() {
    saveForm(note)
    const url = `${location.origin}${location.pathname}#/read/${encodeNote(note)}`
    try {
      await navigator.clipboard.writeText(url)
      alert('Link copied!')
    } catch {
      prompt('Copy this link:', url)
    }
  }

  async function publish() {
    const settings = getSettings()
    if (!settings.sheetsEndpoint) {
      alert('Connect Google Sheets first (⚙ Sheets setup) — the hub lives in your spreadsheet.')
      return
    }
    if (tooLong) {
      alert('This post is too long to publish. Shorten it, or split it into two posts.')
      return
    }
    setHubBusy(true)
    try {
      await publishToHub(settings.sheetsEndpoint, note, settings.publishKey)
      update({ published: true })
      alert(note.published
        ? 'Hub updated — the girls now see the latest version.'
        : 'Published! This post now appears on the student hub.')
    } catch (err) {
      alert('Could not publish: ' + err.message)
    } finally {
      setHubBusy(false)
    }
  }

  async function unpublish() {
    const settings = getSettings()
    setHubBusy(true)
    try {
      await unpublishFromHub(settings.sheetsEndpoint, note.id, settings.publishKey)
      update({ published: false })
      alert('Removed from the student hub.')
    } catch (err) {
      alert('Could not unpublish: ' + err.message)
    } finally {
      setHubBusy(false)
    }
  }

  const chars = (note.body || '').length

  return (
    <div className="page">
      <header className="topbar">
        <a className="btn ghost" href="#/">← Forms</a>
        <div className="topbar-actions">
          <span className={`save-tick ${savedTick ? 'show' : ''}`}>Saved ✓</span>
          <a className="btn" href={`#/read-preview/${note.id}`} onClick={() => saveForm(note)}>Preview</a>
          <button className="btn" disabled={hubBusy} onClick={publish}>
            {hubBusy ? '…' : note.published ? 'Update hub' : 'Publish to hub'}
          </button>
          {note.published && (
            <button className="btn danger" disabled={hubBusy} onClick={unpublish}>Unpublish</button>
          )}
          <button className="btn primary" onClick={copyLink}>Share</button>
        </div>
      </header>

      <div className="card form-header-card">
        <AutoGrowInput
          className="title-input"
          value={note.title}
          placeholder="Title — e.g. Farbrengen, Yud Shevat"
          onChange={(title) => update({ title })}
        />
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={note.accepting}
            onChange={(e) => update({ accepting: e.target.checked })}
          />
          Visible on the hub
        </label>
      </div>

      <div className="card">
        <AutoGrowInput
          className="note-body-input"
          multiline
          value={note.body}
          placeholder="Paste or write the whole write-up here. Paragraphs stay exactly as you type them."
          onChange={(body) => update({ body })}
        />
        <div className={`muted small note-count ${tooLong ? 'over' : ''}`}>
          {chars.toLocaleString()} characters
          {tooLong && ` — too long to publish (limit ${NOTE_MAX_CHARS.toLocaleString()}). Split it into two posts.`}
        </div>
      </div>
    </div>
  )
}
