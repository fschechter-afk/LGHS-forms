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

// Posts an action to the Apps Script web app and insists on a real JSON "ok".
// Anything else — a Google sign-in page because access isn't "Anyone", or an
// older deployed script that doesn't know this action — is an error, not a
// silent success.
async function postAction(endpoint, payload, what) {
  const res = await sendToSheets(endpoint, payload)
  const text = await res.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(
      `${what} failed — the Apps Script didn't reply with data. In Apps Script check ` +
      `Deploy → Manage deployments: "Who has access" must be Anyone. Then redeploy ` +
      `(✏️ Edit → Version: New version).`
    )
  }
  if (body.ok !== true) throw new Error(body.error || `${what} failed`)
  return body
}

// Publish/unpublish a form on the student hub (stored in the spreadsheet).
// After publishing we read the hub back, because an out-of-date script accepts
// an unknown action as a plain submission and happily answers "ok".
export async function publishToHub(endpoint, form, key) {
  await postAction(endpoint, {
    action: 'publish',
    key: key || '',
    form: {
      id: form.id,
      title: form.title,
      description: form.description,
      accepting: form.accepting,
      questions: form.questions,
    },
  }, 'Publishing')

  const forms = await fetchHubForms(endpoint).catch(() => null)
  if (forms && !forms.some((f) => f.id === form.id)) {
    throw new Error(
      'The script accepted it but the form is not in the hub, so your Apps Script ' +
      'is an older version. Paste the latest apps-script/Code.gs, then redeploy ' +
      '(Deploy → Manage deployments → ✏️ Edit → Version: New version).'
    )
  }
}

export async function unpublishFromHub(endpoint, formId, key) {
  await postAction(endpoint, { action: 'unpublish', key: key || '', formId }, 'Unpublishing')
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
