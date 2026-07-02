import React, { useEffect, useRef, useState } from 'react'
import { getForm, saveForm, newQuestion, QUESTION_TYPES, getSettings, encodeForm } from '../storage.js'

export default function Builder({ formId }) {
  const [form, setForm] = useState(() => getForm(formId))
  const [savedTick, setSavedTick] = useState(false)
  const saveTimer = useRef(null)

  // Autosave (debounced) whenever the form changes.
  useEffect(() => {
    if (!form) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveForm(form)
      setSavedTick(true)
      setTimeout(() => setSavedTick(false), 1200)
    }, 400)
    return () => clearTimeout(saveTimer.current)
  }, [form])

  if (!form) {
    return (
      <div className="page">
        <p>Form not found. <a href="#/">Back to your forms</a></p>
      </div>
    )
  }

  const update = (patch) => setForm({ ...form, ...patch })

  const updateQuestion = (qid, patch) =>
    update({ questions: form.questions.map((q) => (q.id === qid ? { ...q, ...patch } : q)) })

  const changeType = (qid, type) =>
    update({
      questions: form.questions.map((q) => {
        if (q.id !== qid) return q
        const fresh = newQuestion(type)
        return { ...fresh, id: q.id, label: q.label, required: q.required, options: q.options || fresh.options }
      }),
    })

  const addQuestion = () => update({ questions: [...form.questions, newQuestion()] })

  const removeQuestion = (qid) =>
    update({ questions: form.questions.filter((q) => q.id !== qid) })

  const duplicateQuestion = (qid) => {
    const i = form.questions.findIndex((q) => q.id === qid)
    const copy = { ...JSON.parse(JSON.stringify(form.questions[i])), id: newQuestion().id }
    const qs = [...form.questions]
    qs.splice(i + 1, 0, copy)
    update({ questions: qs })
  }

  const move = (qid, dir) => {
    const i = form.questions.findIndex((q) => q.id === qid)
    const j = i + dir
    if (j < 0 || j >= form.questions.length) return
    const qs = [...form.questions]
    ;[qs[i], qs[j]] = [qs[j], qs[i]]
    update({ questions: qs })
  }

  async function copyLink() {
    saveForm(form)
    const url = `${location.origin}${location.pathname}#/fill/${encodeForm(form, getSettings().sheetsEndpoint)}`
    try {
      await navigator.clipboard.writeText(url)
      alert('Share link copied!')
    } catch {
      prompt('Copy this link:', url)
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <a className="btn ghost" href="#/">← Forms</a>
        <div className="topbar-actions">
          <span className={`save-tick ${savedTick ? 'show' : ''}`}>Saved ✓</span>
          <a className="btn" href={`#/preview/${form.id}`}>Preview</a>
          <a className="btn" href={`#/responses/${form.id}`}>Responses</a>
          <button className="btn primary" onClick={copyLink}>Share</button>
        </div>
      </header>

      <div className="card form-header-card">
        <input
          className="title-input"
          value={form.title}
          placeholder="Form title"
          onChange={(e) => update({ title: e.target.value })}
        />
        <textarea
          className="desc-input"
          value={form.description}
          placeholder="Form description (optional)"
          rows={2}
          onChange={(e) => update({ description: e.target.value })}
        />
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={form.accepting}
            onChange={(e) => update({ accepting: e.target.checked })}
          />
          Accepting responses
        </label>
      </div>

      {form.questions.map((q, i) => (
        <QuestionEditor
          key={q.id}
          q={q}
          index={i}
          total={form.questions.length}
          onChange={(patch) => updateQuestion(q.id, patch)}
          onType={(t) => changeType(q.id, t)}
          onRemove={() => removeQuestion(q.id)}
          onDuplicate={() => duplicateQuestion(q.id)}
          onMove={(dir) => move(q.id, dir)}
        />
      ))}

      <button className="btn add-question" onClick={addQuestion}>+ Add question</button>
    </div>
  )
}

function QuestionEditor({ q, index, total, onChange, onType, onRemove, onDuplicate, onMove }) {
  const hasOptions = q.type === 'choice' || q.type === 'checkbox' || q.type === 'dropdown'

  const setOption = (i, value) => {
    const options = [...q.options]
    options[i] = value
    onChange({ options })
  }

  return (
    <div className="card question-card">
      <div className="question-row">
        <input
          className="question-label"
          value={q.label}
          placeholder={`Question ${index + 1}`}
          onChange={(e) => onChange({ label: e.target.value })}
        />
        <select value={q.type} onChange={(e) => onType(e.target.value)}>
          {QUESTION_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      {hasOptions && (
        <div className="options">
          {q.options.map((opt, i) => (
            <div key={i} className="option-row">
              <span className="option-glyph">
                {q.type === 'choice' ? '◯' : q.type === 'checkbox' ? '☐' : `${i + 1}.`}
              </span>
              <input value={opt} onChange={(e) => setOption(i, e.target.value)} />
              <button
                className="icon-btn"
                title="Remove option"
                disabled={q.options.length === 1}
                onClick={() => onChange({ options: q.options.filter((_, j) => j !== i) })}
              >✕</button>
            </div>
          ))}
          <button
            className="btn small"
            onClick={() => onChange({ options: [...q.options, `Option ${q.options.length + 1}`] })}
          >+ Add option</button>
        </div>
      )}

      {q.type === 'scale' && (
        <div className="scale-config">
          <label>
            From
            <select value={q.min} onChange={(e) => onChange({ min: Number(e.target.value) })}>
              <option value={0}>0</option>
              <option value={1}>1</option>
            </select>
          </label>
          <label>
            to
            <select value={q.max} onChange={(e) => onChange({ max: Number(e.target.value) })}>
              {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <input
            placeholder={`Label for ${q.min} (optional)`}
            value={q.minLabel}
            onChange={(e) => onChange({ minLabel: e.target.value })}
          />
          <input
            placeholder={`Label for ${q.max} (optional)`}
            value={q.maxLabel}
            onChange={(e) => onChange({ maxLabel: e.target.value })}
          />
        </div>
      )}

      {(q.type === 'short' || q.type === 'paragraph' || q.type === 'date' || q.type === 'time') && (
        <div className="muted small answer-hint">
          {q.type === 'short' && 'Short answer text'}
          {q.type === 'paragraph' && 'Long answer text'}
          {q.type === 'date' && 'Date picker'}
          {q.type === 'time' && 'Time picker'}
        </div>
      )}

      <div className="question-footer">
        <button className="icon-btn" title="Move up" disabled={index === 0} onClick={() => onMove(-1)}>↑</button>
        <button className="icon-btn" title="Move down" disabled={index === total - 1} onClick={() => onMove(1)}>↓</button>
        <button className="icon-btn" title="Duplicate" onClick={onDuplicate}>⧉</button>
        <button className="icon-btn" title="Delete" disabled={total === 1} onClick={onRemove}>🗑</button>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={q.required}
            onChange={(e) => onChange({ required: e.target.checked })}
          />
          Required
        </label>
      </div>
    </div>
  )
}
