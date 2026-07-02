import React, { useState } from 'react'
import { addResponse, uid } from '../storage.js'
import { submitOrQueue } from '../sheets.js'

export default function FillForm({ form, endpoint, preview = false, shared = false, onBack }) {
  const [answers, setAnswers] = useState({})
  const [errors, setErrors] = useState({})
  const [state, setState] = useState('editing') // editing | sending | done
  const [sendResult, setSendResult] = useState(null)

  if (!form) {
    return (
      <div className="page fill-page">
        <div className="card">
          <p>This form link is invalid or the form no longer exists.</p>
          {!shared && <a href="#/">Back to your forms</a>}
        </div>
      </div>
    )
  }

  if (form.accepting === false && !preview) {
    return (
      <div className="page fill-page">
        <div className="card">
          <h1>{form.title}</h1>
          <p className="muted">This form is no longer accepting responses.</p>
        </div>
      </div>
    )
  }

  const setAnswer = (qid, value) => {
    setAnswers({ ...answers, [qid]: value })
    if (errors[qid]) setErrors({ ...errors, [qid]: false })
  }

  function validate() {
    const errs = {}
    for (const q of form.questions) {
      if (!q.required) continue
      const v = answers[q.id]
      const empty = v == null || v === '' || (Array.isArray(v) && v.length === 0)
      if (empty) errs[q.id] = true
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function submit() {
    if (!validate()) {
      document.querySelector('.question-card.error')?.scrollIntoView({ behavior: 'smooth' })
      return
    }
    setState('sending')

    const answerList = form.questions.map((q) => ({
      question: q.label || 'Untitled question',
      answer: Array.isArray(answers[q.id]) ? answers[q.id].join(', ') : (answers[q.id] ?? ''),
    }))
    const payload = {
      formId: form.id,
      formTitle: form.title || 'Untitled form',
      submittedAt: new Date().toISOString(),
      answers: answerList,
    }

    if (preview) {
      setSendResult({ status: 'preview' })
      setState('done')
      return
    }

    // Keep a local copy on this device, then sync to Google Sheets.
    addResponse(form.id, { id: uid(), submittedAt: payload.submittedAt, answers: answerList })
    const result = await submitOrQueue(endpoint, payload)
    setSendResult(result)
    setState('done')
  }

  if (state === 'done') {
    return (
      <div className="page fill-page">
        <div className="card done-card">
          <h1>Response recorded ✓</h1>
          {sendResult?.status === 'sent' && <p className="muted">Your response was sent to the form owner's Google Sheet.</p>}
          {sendResult?.status === 'queued' && <p className="muted">You're offline — your response is saved and will sync to Google Sheets automatically when you're back online.</p>}
          {sendResult?.status === 'local-only' && <p className="muted">Saved on this device. (No Google Sheet is connected to this form.)</p>}
          {sendResult?.status === 'preview' && <p className="muted">Preview mode — nothing was saved or sent.</p>}
          <button className="btn primary" onClick={() => { setAnswers({}); setErrors({}); setState('editing') }}>
            Submit another response
          </button>
          {onBack && <button className="btn ghost" onClick={onBack}>← All forms</button>}
          {!shared && <a className="btn ghost" href="#/">Back to your forms</a>}
        </div>
      </div>
    )
  }

  return (
    <div className="page fill-page">
      {onBack && (
        <header className="topbar">
          <button className="btn ghost" onClick={onBack}>← All forms</button>
        </header>
      )}
      {preview && (
        <div className="banner static">Preview — submissions here are not saved. <a href={`#/edit/${form.id}`}>Back to editing</a></div>
      )}
      <div className="card form-header-card fill-header">
        <h1>{form.title || 'Untitled form'}</h1>
        {form.description && <p className="muted">{form.description}</p>}
        {form.questions.some((q) => q.required) && <p className="required-note">* Required</p>}
      </div>

      {form.questions.map((q) => (
        <div key={q.id} className={`card question-card ${errors[q.id] ? 'error' : ''}`}>
          <div className="fill-label">
            {q.label || 'Untitled question'}
            {q.required && <span className="required-star"> *</span>}
          </div>
          <QuestionInput q={q} value={answers[q.id]} onChange={(v) => setAnswer(q.id, v)} />
          {errors[q.id] && <div className="error-text">This question is required.</div>}
        </div>
      ))}

      <button className="btn primary submit-btn" disabled={state === 'sending'} onClick={submit}>
        {state === 'sending' ? 'Submitting…' : 'Submit'}
      </button>
    </div>
  )
}

function QuestionInput({ q, value, onChange }) {
  switch (q.type) {
    case 'short':
      return <input className="fill-input" value={value || ''} placeholder="Your answer" onChange={(e) => onChange(e.target.value)} />
    case 'paragraph':
      return <textarea className="fill-input" rows={4} value={value || ''} placeholder="Your answer" onChange={(e) => onChange(e.target.value)} />
    case 'date':
      return <input className="fill-input" type="date" value={value || ''} onChange={(e) => onChange(e.target.value)} />
    case 'time':
      return <input className="fill-input" type="time" value={value || ''} onChange={(e) => onChange(e.target.value)} />
    case 'dropdown':
      return (
        <select className="fill-input" value={value || ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {q.options.map((opt, i) => <option key={i} value={opt}>{opt}</option>)}
        </select>
      )
    case 'choice':
      return (
        <div className="choice-list">
          {q.options.map((opt, i) => (
            <label key={i} className="choice-row">
              <input type="radio" name={q.id} checked={value === opt} onChange={() => onChange(opt)} />
              {opt}
            </label>
          ))}
        </div>
      )
    case 'checkbox': {
      const selected = Array.isArray(value) ? value : []
      const toggle = (opt) =>
        onChange(selected.includes(opt) ? selected.filter((o) => o !== opt) : [...selected, opt])
      return (
        <div className="choice-list">
          {q.options.map((opt, i) => (
            <label key={i} className="choice-row">
              <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} />
              {opt}
            </label>
          ))}
        </div>
      )
    }
    case 'scale': {
      const nums = []
      for (let n = q.min; n <= q.max; n++) nums.push(n)
      return (
        <div className="scale-row">
          {q.minLabel && <span className="muted small">{q.minLabel}</span>}
          {nums.map((n) => (
            <label key={n} className="scale-cell">
              <span>{n}</span>
              <input type="radio" name={q.id} checked={value === String(n)} onChange={() => onChange(String(n))} />
            </label>
          ))}
          {q.maxLabel && <span className="muted small">{q.maxLabel}</span>}
        </div>
      )
    }
    default:
      return null
  }
}
