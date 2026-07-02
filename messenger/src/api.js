// Talks to the Apps Script backend. Requests use a text/plain body so they
// stay "simple" requests (no CORS preflight, which Apps Script doesn't answer).

import { getSession, getOutbox, setOutbox, pushOutbox, uid } from './storage.js'

export async function rawCall(apiUrl, action, params = {}) {
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...params }),
    redirect: 'follow',
  })
  if (!res.ok) throw new Error('Server returned ' + res.status)
  const data = await res.json()
  if (!data.ok) {
    const err = new Error(data.message || data.error || 'Request failed')
    err.code = data.error
    throw err
  }
  return data
}

export async function call(action, params = {}) {
  const session = getSession()
  if (!session) throw new Error('Not signed in')
  return rawCall(session.apiUrl, action, { token: session.token, ...params })
}

// Send a message now, or queue it for when we're back online.
export async function sendOrQueue(channelId, payload) {
  try {
    return await call('send', { channelId, ...payload })
  } catch (err) {
    // Auth/permission failures shouldn't be retried blindly.
    if (err.code) throw err
    pushOutbox({ id: uid(), channelId, payload, queuedAt: Date.now() })
    return { queued: true }
  }
}

export async function flushOutbox() {
  const queue = getOutbox()
  if (!queue.length) return 0
  const remaining = []
  let sent = 0
  for (const item of queue) {
    try {
      await call('send', { channelId: item.channelId, ...item.payload })
      sent++
    } catch (err) {
      if (err.code) {
        // Rejected by the server (deleted channel, revoked account…): drop it.
        continue
      }
      remaining.push(item)
    }
  }
  setOutbox(remaining)
  return sent
}
