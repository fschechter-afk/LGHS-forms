// Sends submissions to the Google Apps Script webhook that writes into Google Sheets.
// Requests use a text/plain body so they stay "simple" (no CORS preflight,
// which Apps Script web apps don't answer).

import { getQueue, setQueue, pushQueue, uid } from './storage.js'

export async function sendToSheets(endpoint, payload) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
    redirect: 'follow',
  })
  if (!res.ok) throw new Error('Sheets webhook returned ' + res.status)
  return res
}

// Publish/unpublish a form on the student hub (stored in the spreadsheet).
// Throws with the webhook's error message on failure (e.g. wrong publish key).
export async function publishToHub(endpoint, form, key) {
  const res = await sendToSheets(endpoint, {
    action: 'publish',
    key: key || '',
    form: {
      id: form.id,
      title: form.title,
      description: form.description,
      accepting: form.accepting,
      questions: form.questions,
    },
  })
  const body = await res.json().catch(() => ({}))
  if (body.ok === false) throw new Error(body.error || 'Publish failed')
}

export async function unpublishFromHub(endpoint, formId, key) {
  const res = await sendToSheets(endpoint, { action: 'unpublish', key: key || '', formId })
  const body = await res.json().catch(() => ({}))
  if (body.ok === false) throw new Error(body.error || 'Unpublish failed')
}

export async function fetchHubForms(endpoint) {
  const url = endpoint + (endpoint.includes('?') ? '&' : '?') + 'list=1'
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error('Hub returned ' + res.status)
  const body = await res.json()
  if (!body.ok) throw new Error(body.error || 'Hub error')
  return body.forms || []
}

// Submit now if online; otherwise queue and let flushQueue retry later.
export async function submitOrQueue(endpoint, payload) {
  if (!endpoint) return { status: 'local-only' }
  try {
    await sendToSheets(endpoint, payload)
    return { status: 'sent' }
  } catch {
    pushQueue({ id: uid(), endpoint, payload, queuedAt: Date.now() })
    return { status: 'queued' }
  }
}

export async function flushQueue() {
  const queue = getQueue()
  if (!queue.length) return 0
  const remaining = []
  let sent = 0
  for (const item of queue) {
    try {
      await sendToSheets(item.endpoint, item.payload)
      sent++
    } catch {
      remaining.push(item)
    }
  }
  setQueue(remaining)
  return sent
}
