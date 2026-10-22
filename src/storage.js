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

// A post is something to read rather than fill in — a farbrengen write-up,
// an announcement. It rides the same storage and hub as forms, marked by
// `kind`, so no Apps Script change is needed to publish one.
export function newNote() {
  return {
    id: uid(),
    kind: 'note',
    title: 'Untitled post',
    body: '',
    accepting: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

export const isNote = (item) => item?.kind === 'note'

// A published item is stored in one spreadsheet cell, which Google caps at
// 50,000 characters; leave room for the JSON escaping around the text.
export const NOTE_MAX_CHARS = 40000

export function newQuestion(type = 'short') {  const base = { id: uid(), type, label: '', required: false }
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
  return { sheetsEndpoint: '', sheetUrl: '', publishKey: '', ...read(SETTINGS_KEY, {}) }
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

export function encodeText(text) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeText(encoded) {
  try {
    const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

export function encodeForm(form, endpoint) {
  const payload = {
    id: form.id,
    title: form.title,
    description: form.description,
    questions: form.questions,
    endpoint: endpoint || '',
  }
  return encodeText(JSON.stringify(payload))
}

export function decodeForm(encoded) {
  try {
    return JSON.parse(decodeText(encoded))
  } catch {
    return null
  }
}

// Share link for a single post, for sending outside the hub.
export function encodeNote(note) {
  return encodeText(JSON.stringify({
    id: note.id,
    kind: 'note',
    title: note.title,
    body: note.body,
  }))
}

export function decodeNote(encoded) {
  try {
    const note = JSON.parse(decodeText(encoded))
    return note && note.kind === 'note' ? note : null
  } catch {
    return null
  }
}

// ---- Student hub: one permanent link listing published forms ----

export function hubLink(endpoint) {
  return `${location.origin}${location.pathname}#/hub/${encodeText(endpoint)}`
}

// ---- Moving the setup to another device (laptop → phone) ----
// Settings live only in this browser's storage, so this packs them into a
// link the owner sends to themselves and opens on the other device.

export function setupLink(settings) {
  const payload = JSON.stringify({
    e: settings.sheetsEndpoint || '',
    s: settings.sheetUrl || '',
    k: settings.publishKey || '',
  })
  return `${location.origin}${location.pathname}#/setup/${encodeText(payload)}`
}

export function decodeSetup(encoded) {
  try {
    const { e, s, k } = JSON.parse(decodeText(encoded))
    if (!e) return null
    return { sheetsEndpoint: e, sheetUrl: s || '', publishKey: k || '' }
  } catch {
    return null
  }
}
