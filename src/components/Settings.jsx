import React, { useState } from 'react'
import { getSettings, saveSettings, getQueue } from '../storage.js'
import { sendToSheets, flushQueue } from '../sheets.js'

export default function Settings() {
  const [settings, setSettings] = useState(getSettings())
  const [testState, setTestState] = useState(null)
  const queued = getQueue().length

  function save(patch) {
    const next = { ...settings, ...patch }
    setSettings(next)
    saveSettings(next)
  }

  async function testConnection() {
    setTestState('testing')
    try {
      await sendToSheets(settings.sheetsEndpoint, {
        formId: '_test',
        formTitle: 'Connection test',
        submittedAt: new Date().toISOString(),
        answers: [{ question: 'Status', answer: 'It works! You can delete this sheet tab.' }],
      })
      setTestState('ok')
    } catch {
      setTestState('fail')
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <a className="btn ghost" href="#/">← Forms</a>
      </header>

      <div className="page-head">
        <h1>Google Sheets link</h1>
      </div>

      <div className="card">
        <p>
          Connect once and every form automatically writes its responses into your
          Google Sheet — one tab per form, headers created for you.
        </p>
        <ol className="setup-steps">
          <li>Create (or open) a Google Sheet at <strong>sheets.new</strong>.</li>
          <li>In the Sheet, open <strong>Extensions → Apps Script</strong>.</li>
          <li>Delete the sample code and paste in the contents of <code>apps-script/Code.gs</code> from this project (see the README).</li>
          <li>Click <strong>Deploy → New deployment → Web app</strong>. Set <em>Execute as: Me</em> and <em>Who has access: Anyone</em>, then deploy.</li>
          <li>Copy the <strong>Web app URL</strong> and paste it below.</li>
        </ol>

        <label className="field">
          Web app URL (ends in <code>/exec</code>)
          <input
            className="fill-input"
            placeholder="https://script.google.com/macros/s/…/exec"
            value={settings.sheetsEndpoint}
            onChange={(e) => save({ sheetsEndpoint: e.target.value.trim() })}
          />
        </label>

        <label className="field">
          Google Sheet URL (optional — adds an "Open the Sheet" shortcut on the responses page)
          <input
            className="fill-input"
            placeholder="https://docs.google.com/spreadsheets/d/…"
            value={settings.sheetUrl}
            onChange={(e) => save({ sheetUrl: e.target.value.trim() })}
          />
        </label>

        <div className="settings-actions">
          <button className="btn primary" disabled={!settings.sheetsEndpoint || testState === 'testing'} onClick={testConnection}>
            {testState === 'testing' ? 'Testing…' : 'Send a test row'}
          </button>
          {testState === 'ok' && <span className="ok-text">✓ Success — check your Sheet for a "Connection test" tab.</span>}
          {testState === 'fail' && <span className="error-text">Couldn't reach the web app. Check the URL and that access is set to "Anyone".</span>}
        </div>
      </div>

      {queued > 0 && (
        <div className="card">
          <p>{queued} response{queued === 1 ? '' : 's'} waiting to sync (submitted while offline).</p>
          <button className="btn" onClick={() => flushQueue().then(() => location.reload())}>Retry now</button>
        </div>
      )}

      <div className="card">
        <p className="muted small">
          Note: share links snapshot the current Sheets connection. If you change the
          web app URL later, re-copy and re-send your form links so new responses go
          to the right place.
        </p>
      </div>
    </div>
  )
}
