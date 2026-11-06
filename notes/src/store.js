// Local, on-phone copy of one account's notes.
//
// Every note is written to localStorage (a few hundred milliseconds after the
// last keystroke, and immediately whenever the app is hidden or closed), so
// nothing typed is ever lost — even with no internet, even if the app is
// swiped away. The sync layer then copies changed ("dirty") notes to the
// server and brings down changes made on other devices.
//
// A note: { id, title, blocks: [{ id, type: 'text'|'check', text, done }],
//           createdAt, updatedAt, deleted }

const ROOT = 'lghs-notes:v1:'

export function openStore(account) {
  const prefix = ROOT + account + ':'
  const noteKey = (id) => prefix + 'n:' + id
  const metaKey = prefix + 'meta'

  const notes = new Map()
  let meta = { dirty: [], cursor: null }
  const pending = new Set()
  const listeners = new Set()
  let timer = null

  // ---- load
  try {
    meta = { ...meta, ...JSON.parse(localStorage.getItem(metaKey) || '{}') }
  } catch {}
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (!k || !k.startsWith(prefix + 'n:')) continue
    try {
      const n = JSON.parse(localStorage.getItem(k))
      if (n && n.id) notes.set(n.id, n)
    } catch {}
  }
  const dirty = new Set(meta.dirty)

  const emit = (type, detail) => listeners.forEach((fn) => fn(type, detail))

  function writeNow() {
    clearTimeout(timer)
    timer = null
    try {
      for (const id of pending) {
        const n = notes.get(id)
        if (n) localStorage.setItem(noteKey(id), JSON.stringify(n))
        else localStorage.removeItem(noteKey(id))
      }
      pending.clear()
      meta.dirty = [...dirty]
      localStorage.setItem(metaKey, JSON.stringify(meta))
    } catch (err) {
      // Almost always "storage full" (iOS gives each web app several MB).
      emit('error', err)
    }
  }
  function schedule(id) {
    if (id) pending.add(id)
    clearTimeout(timer)
    timer = setTimeout(writeNow, 250)
  }

  return {
    list() {
      return [...notes.values()].filter((n) => !n.deleted).sort((a, b) => b.updatedAt - a.updatedAt)
    },
    get(id) {
      const n = notes.get(id)
      return n ? structuredClone(n) : null
    },
    // Save a local edit. Returns the timestamp it was saved with.
    put(note) {
      const prev = notes.get(note.id)
      const updatedAt = Math.max(Date.now(), (prev?.updatedAt || 0) + 1)
      notes.set(note.id, { ...structuredClone(note), updatedAt })
      dirty.add(note.id)
      schedule(note.id)
      emit('local', note.id)
      return updatedAt
    },
    remove(id) {
      const n = notes.get(id)
      if (n) this.put({ ...n, deleted: true })
    },
    // A newer version arrived from the server. Last edit wins, per note.
    applyRemote(n) {
      const local = notes.get(n.id)
      if (local && local.updatedAt >= n.updatedAt) return false
      notes.set(n.id, n)
      dirty.delete(n.id)
      schedule(n.id)
      emit('remote', n.id)
      return true
    },
    dirtyIds: () => [...dirty],
    // The server has this version; only clean it if nothing changed since.
    markClean(id, updatedAt) {
      if (notes.get(id)?.updatedAt === updatedAt) {
        dirty.delete(id)
        schedule()
      }
    },
    get cursor() {
      return meta.cursor
    },
    set cursor(value) {
      meta.cursor = value
      schedule()
    },
    flush: writeNow,
    on(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    // Wipe this account's notes from the phone (used on sign-out).
    destroy() {
      clearTimeout(timer)
      const keys = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith(prefix)) keys.push(k)
      }
      keys.forEach((k) => localStorage.removeItem(k))
      notes.clear()
      listeners.clear()
    },
  }
}
