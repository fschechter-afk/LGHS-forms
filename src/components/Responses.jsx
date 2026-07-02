import React from 'react'
import { getForm, listResponses, getSettings } from '../storage.js'

export default function Responses({ formId }) {
  const form = getForm(formId)
  const responses = listResponses(formId)
  const settings = getSettings()

  if (!form) {
    return (
      <div className="page">
        <p>Form not found. <a href="#/">Back to your forms</a></p>
      </div>
    )
  }

  const columns = form.questions.map((q) => q.label || 'Untitled question')

  function exportCsv() {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const header = ['Timestamp', ...columns].map(esc).join(',')
    const rows = responses.map((r) => {
      const byQuestion = Object.fromEntries(r.answers.map((a) => [a.question, a.answer]))
      return [new Date(r.submittedAt).toLocaleString(), ...columns.map((c) => byQuestion[c])].map(esc).join(',')
    })
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${(form.title || 'form').replace(/[^\w\- ]+/g, '')}-responses.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="page">
      <header className="topbar">
        <a className="btn ghost" href={`#/edit/${form.id}`}>← Back to editor</a>
        <div className="topbar-actions">
          {responses.length > 0 && <button className="btn" onClick={exportCsv}>Export CSV</button>}
        </div>
      </header>

      <div className="page-head">
        <h1>{form.title} — responses</h1>
      </div>

      {settings.sheetUrl ? (
        <a className="banner static link" href={settings.sheetUrl} target="_blank" rel="noreferrer">
          📊 Open the Google Sheet — all responses from every device are collected there.
        </a>
      ) : (
        <div className="banner static">
          Responses from other people's devices go to your Google Sheet
          (<a href="#/settings">set it up here</a>). Below are responses submitted from <em>this</em> device.
        </div>
      )}

      {responses.length === 0 ? (
        <div className="empty">
          <p>No responses on this device yet.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Timestamp</th>
                {columns.map((c, i) => <th key={i}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {responses.map((r) => {
                const byQuestion = Object.fromEntries(r.answers.map((a) => [a.question, a.answer]))
                return (
                  <tr key={r.id}>
                    <td>{new Date(r.submittedAt).toLocaleString()}</td>
                    {columns.map((c, i) => <td key={i}>{byQuestion[c]}</td>)}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
