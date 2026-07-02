// All local state lives under one localStorage key: the signed-in session,
// per-channel read markers, and the offline outbox.

const KEY = 'ljhs-messenger-v1'

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {}
  } catch {
    return {}
  }
}

function save(state) {
  localStorage.setItem(KEY, JSON.stringify(state))
}

export function getSession() {
  const s = load()
  return s.session || null // { apiUrl, token, user, settings }
}

export function setSession(session) {
  const s = load()
  s.session = session
  save(s)
}

export function clearSession() {
  const s = load()
  delete s.session
  delete s.lastRead
  delete s.outbox
  save(s)
}

export function updateSettings(settings) {
  const s = load()
  if (s.session) {
    s.session.settings = settings
    save(s)
  }
}

// -- read markers (unread badges) --

export function getLastRead() {
  return load().lastRead || {}
}

export function markRead(channelId, ts) {
  const s = load()
  s.lastRead = s.lastRead || {}
  if ((s.lastRead[channelId] || 0) < ts) {
    s.lastRead[channelId] = ts
    save(s)
  }
}

// -- offline outbox --

export function getOutbox() {
  return load().outbox || []
}

export function setOutbox(items) {
  const s = load()
  s.outbox = items
  save(s)
}

export function pushOutbox(item) {
  const s = load()
  s.outbox = s.outbox || []
  s.outbox.push(item)
  save(s)
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}
