import React, { useState } from 'react'
import { decodeSetup, getSettings, saveSettings } from '../storage.js'

// Opened from a setup link made on another device. Nothing is saved until the
// owner confirms, so following the link never silently replaces a working
// connection on this device.
export default function Setup({ data }) {
  const incoming = decodeSetup(data)
  const current = getSettings()
  const [done, setDone] = useState(false)

  if (!incoming) {
    return (
      <div className="page fill-page">
        <div className="card">
          <h2 className="card-title">That setup link didn't work</h2>
          <p className="muted small">
            It may have been cut short by the app you sent it through. Copy it again
            and make sure the whole link comes across.
          </p>
          <a className="btn" href="#/">← Back</a>
        </div>
      </div>
    )
  }

  function connect() {
    saveSettings({ ...current, ...incoming })
    setDone(true)
  }

  return (
    <div className="page fill-page">
      <div className="card">
        <h2 className="card-title">{done ? '✓ This device is connected' : 'Connect this device'}</h2>
        {done ? (
          <>
            <p>Your forms on this device now save responses to that Google Sheet.</p>
            <a className="btn primary" href="#/">Go to my forms</a>
          </>
        ) : (
          <>
            <p className="muted small">
              This link carries the Google Sheets connection from your other device.
            </p>
            <div className="student-link-url">{incoming.sheetsEndpoint}</div>
            {current.sheetsEndpoint && current.sheetsEndpoint !== incoming.sheetsEndpoint && (
              <p className="required-note">
                This device is already connected to a different sheet. Connecting will
                replace it, and responses will go to the new one.
              </p>
            )}
            <div className="settings-actions">
              <button className="btn primary" onClick={connect}>Connect this device</button>
              <a className="btn" href="#/">Cancel</a>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
