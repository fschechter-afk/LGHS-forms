// Local persistence for forms, responses, settings, and the offline send queue.

const FORMS_KEY = 'lghsforms.forms'
const RESPONSES_KEY = 'lghsforms.responses'
const SETTINGS_KEY = 'lghsforms.settings'
const QUEUE_KEY = 'lghsforms.queue'

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}

export function uid() {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36)
}

// ---- Forms ----

export function listForms() {
  return read(FORMS_KEY, [])
}

export function getForm(id) {
  return listForms().find((f) => f.id === id) || null
}

export function saveForm(form) {
  const forms = listForms()
  const i = forms.findIndex((f) => f.id === form.id)
  const updated = { ...form, updatedAt: Date.now() }
  if (i >= 0) forms[i] = updated
  else forms.unshift(updated)
  write(FORMS_KEY, forms)
  return updated
}

export function deleteForm(id) {
  write(FORMS_KEY, listForms().filter((f) => f.id !== id))
  const all = read(RESPONSES_KEY, {})
  delete all[id]
  write(RESPONSES_KEY, all)
}

export function newForm() {
  return {
    id: uid(),
    title: 'Untitled form',
    description: '',
    accepting: true,
    questions: [newQuestion()],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

export function newQuestion(type = 'short') {
  const base = { id: uid(), type, label: '', required: false }
  if (type === 'choice' || type === 'checkbox' || type === 'dropdown') {
    base.options = ['Option 1']
  }
  if (type === 'scale') {
    base.min = 1
    base.max = 5
    base.minLabel = ''
    base.maxLabel = ''
  }
  return base
}

export const QUESTION_TYPES = [
  { value: 'short', label: 'Short answer' },
  { value: 'paragraph', label: 'Paragraph' },
  { value: 'choice', label: 'Multiple choice' },
  { value: 'checkbox', label: 'Checkboxes' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'scale', label: 'Linear scale' },
  { value: 'date', label: 'Date' },
  { value: 'time', label: 'Time' },
]

// ---- Responses (kept locally on the device that submitted) ----

export function listResponses(formId) {
  return read(RESPONSES_KEY, {})[formId] || []
}

export function addResponse(formId, response) {
  const all = read(RESPONSES_KEY, {})
  all[formId] = [...(all[formId] || []), response]
  write(RESPONSES_KEY, all)
}

// ---- Settings ----

export function getSettings() {
  return read(SETTINGS_KEY, { sheetsEndpoint: '', sheetUrl: '' })
}

export function saveSettings(settings) {
  write(SETTINGS_KEY, settings)
}

// ---- Offline send queue ----

export function getQueue() {
  return read(QUEUE_KEY, [])
}

export function pushQueue(item) {
  write(QUEUE_KEY, [...getQueue(), item])
}

export function setQueue(items) {
  write(QUEUE_KEY, items)
}

// ---- Share links: form definition travels inside the URL fragment ----

export function encodeForm(form, endpoint) {
  const payload = {
    id: form.id,
    title: form.title,
    description: form.description,
    questions: form.questions,
    endpoint: endpoint || '',
  }
  const json = JSON.stringify(payload)
  return btoa(String.fromCharCode(...new TextEncoder().encode(json)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeForm(encoded) {
  try {
    const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
}
