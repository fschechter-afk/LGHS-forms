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
