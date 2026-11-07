import './styles.css'
import * as CFG from './config.js'
import { openStore } from './store.js'
import { icon } from './icons.js'

// ================================================================ helpers

const app = document.getElementById('app')

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
    else if (k === 'class') el.className = v
    else if (k === 'value') el.value = v
    else el.setAttribute(k, v === true ? '' : v)
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid)
  return el
}

const uuid = () =>
  crypto.randomUUID
    ? crypto.randomUUID()
    : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
        (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)
      )
let seq = 0
const bid = () => 'b' + Date.now().toString(36) + (seq++).toString(36)
const textBlock = (text = '') => ({ id: bid(), type: 'text', text })
const checkBlock = (text = '', done = false) => ({ id: bid(), type: 'check', text, done })

function noteIsEmpty(n) {
  return !n.title.trim() && n.blocks.every((b) => !b.text.trim())
}

function noteHeading(n) {
  if (n.title.trim()) return n.title.trim()
  for (const b of n.blocks) {
    const line = b.text.split('\n').find((l) => l.trim())
    if (line) return line.trim()
  }
  return 'New Note'
}

function notePreview(n) {
  const lines = []
  for (const b of n.blocks) {
    for (const l of b.text.slice(0, 400).split('\n')) if (l.trim()) lines.push((b.type === 'check' ? (b.done ? '☑ ' : '☐ ') : '') + l.trim())
    if (lines.length > 6) break
  }
  if (!n.title.trim()) lines.shift()
  return lines.join('  ').slice(0, 160) || 'No additional text'
}

function shortDate(ms) {
  const d = new Date(ms)
  const now = new Date()
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(now) - day(d)) / 864e5)
  if (diff === 0) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (diff === 1) return 'Yesterday'
  if (diff < 7) return d.toLocaleDateString([], { weekday: 'long' })
  return d.toLocaleDateString([], { month: 'numeric', day: 'numeric', year: '2-digit' })
}

function longDate(ms) {
  return new Date(ms).toLocaleString([], { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// ================================================================ state

let store = null // local notes for the signed-in account
let account = null // { id, email, test }
let cloud = null // { sb, sync } when signed in for real
let syncStatus = ''
let view = ''
let current = null // the note open in the editor (a working copy)
let lastFocus = null // { id, start, end } — last caret position in a block
let query = ''
let ui = {} // elements of the current screen

const LAST_USER = 'lghs-notes:last-user'
const TEST_MODE = 'lghs-notes:test-mode'

function lsGet(k) {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
function lsSet(k, v) {
  try {
    v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v)
  } catch {}
}

// ================================================================ viewport
// Keep the whole app inside the *visible* part of the screen, so the bottom
// toolbar (with the checklist button) sits right above the iPhone keyboard.

function setupViewport() {
  const vv = window.visualViewport
  const apply = () => {
    const height = vv ? vv.height : window.innerHeight
    const top = vv ? vv.offsetTop : 0
    app.style.height = height + 'px'
    app.style.transform = top ? `translateY(${top}px)` : ''
    document.body.classList.toggle('keyboard', window.innerHeight - height > 120)
  }
  vv?.addEventListener('resize', apply)
  vv?.addEventListener('scroll', apply)
  window.addEventListener('resize', () => {
    apply()
    if (view === 'note') autosizeAll()
  })
  apply()
}

// No drag-and-drop anywhere: dropping a photo or file onto the app does nothing.
for (const type of ['dragenter', 'dragover', 'drop'])
  document.addEventListener(type, (e) => {
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'
  })
// Pasting a photo or file does nothing (plain text pastes normally).
document.addEventListener(
  'paste',
  (e) => {
    const cd = e.clipboardData
    if (cd && cd.files && cd.files.length && !cd.getData('text/plain')) e.preventDefault()
  },
  true
)

// ================================================================ boot

async function boot() {
  setupViewport()
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {})

  const cloudReady = CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY

  if (!cloudReady) {
    if (CFG.ALLOW_TEST_MODE) return startTest()
    return showSignIn('This app has not been connected to the school server yet.')
  }

  // Coming back from Google/Microsoft with an error?
  const params = new URLSearchParams(location.search + '&' + location.hash.slice(1))
  const oauthError = params.get('error_description')

  // Local-first: if someone was signed in on this phone, show her notes
  // immediately (works offline), then confirm the login in the background.
  let last = null
  try {
    last = JSON.parse(lsGet(LAST_USER) || 'null')
  } catch {}
  const returningFromLogin = params.has('code')
  if (last && !returningFromLogin) startAccount(last)
  else if (!last && lsGet(TEST_MODE) && CFG.ALLOW_TEST_MODE && !returningFromLogin) return startTest()
  else if (!returningFromLogin) showSignIn(oauthError)
  else showLoading()

  const { makeClient, createSyncer, emailAllowed } = await import('./sync.js')
  const sb = makeClient()
  const { data, error } = await sb.auth.getSession()
  if (returningFromLogin || oauthError) history.replaceState(null, '', location.pathname)

  const session = data?.session
  if (session) {
    const user = session.user
    if (!emailAllowed(user.email)) {
      await sb.auth.signOut().catch(() => {})
      return showSignIn(`Please sign in with your school email address${CFG.SCHOOL_EMAIL_DOMAIN ? ` (…@${CFG.SCHOOL_EMAIL_DOMAIN})` : ''}.`)
    }
    const who = { id: user.id, email: user.email }
    lsSet(LAST_USER, JSON.stringify(who))
    lsSet(TEST_MODE, null)
    if (!account || account.id !== who.id) startAccount(who)
    cloud = { sb, sync: createSyncer(sb, store, onSyncStatus) }
  } else if (error && account) {
    // Couldn't reach the server (offline). Keep working locally; try again later.
    onSyncStatus('offline')
    const retry = () => {
      window.removeEventListener('online', retry)
      location.reload()
    }
    window.addEventListener('online', retry)
  } else if (account) {
    // Signed out elsewhere or the login expired. Her notes stay on the
    // phone and upload once she signs in again.
    onSyncStatus('signin')
  } else if (!error) {
    showSignIn(oauthError)
  } else {
    showSignIn('Could not reach the school server. Check your internet connection and try again.')
  }

  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT' && account && !account.test && cloud) onSyncStatus('signin')
  })
  window.__notesSignIn = async () => {
    const { signIn } = await import('./sync.js')
    await signIn(sb)
  }
}

function startAccount(who) {
  account = who
  store?.flush()
  store = openStore(who.test ? 'test' : who.id)
  store.on(onStoreEvent)
  showList()
}

function startTest() {
  lsSet(TEST_MODE, '1')
  startAccount({ id: 'test', email: null, test: true })
}

function onStoreEvent(type, id) {
  if (type === 'error') {
    toast('This phone is out of space for notes. Delete some old notes to keep saving.')
    return
  }
  if (view === 'list') renderListItems()
  if (type === 'remote' && view === 'note' && current?.id === id) {
    const fresh = store.get(id)
    const editing = app.contains(document.activeElement) && /TEXTAREA|INPUT/.test(document.activeElement.tagName)
    if (fresh && !editing) {
      if (fresh.deleted) return showList()
      current = fresh
      renderNoteBody()
    }
  }
}

function onSyncStatus(s) {
  syncStatus = s
  renderStatus()
}

function statusText() {
  if (account?.test) return 'Test mode · saved on this phone only'
  switch (syncStatus) {
    case 'synced':
      return 'Backed up'
    case 'pending':
    case 'syncing':
      return 'Saved · backing up…'
    case 'offline':
      return 'Saved on phone · will back up when online'
    case 'signin':
      return 'Saved on phone · sign in to back up'
    case 'denied':
      return 'Not backed up · use your school account'
    case 'error':
      return 'Saved on phone · backup will retry'
    default:
      return 'Saved'
  }
}

function renderStatus() {
  if (!ui.status) return
  const count = store ? store.list().length : 0
  ui.status.replaceChildren(
    view === 'list' ? h('div', { class: 'tb-count' }, `${count} ${count === 1 ? 'Note' : 'Notes'}`) : '',
    h('div', { class: 'tb-sync' + (/signin|denied/.test(syncStatus) ? ' warn' : '') }, statusText())
  )
}

window.addEventListener('pagehide', () => store?.flush())
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && store?.flush())

// ================================================================ sign in

function showLoading() {
  view = 'loading'
  ui = {}
  app.replaceChildren(h('div', { class: 'screen center' }, h('div', { class: 'spinner' })))
}

function showSignIn(message) {
  view = 'signin'
  ui = {}
  const provider = CFG.AUTH_PROVIDER === 'azure' ? 'Microsoft' : 'Google'
  const btn = h(
    'button',
    {
      class: 'primary-btn',
      onclick: async () => {
        btn.disabled = true
        btn.textContent = 'Opening sign-in…'
        try {
          if (!window.__notesSignIn) {
            const { makeClient, signIn } = await import('./sync.js')
            await signIn(makeClient())
          } else await window.__notesSignIn()
        } catch (err) {
          btn.disabled = false
          btn.textContent = 'Sign in with school email'
          showSignIn(err?.message || 'Could not open sign-in. Check your internet connection.')
        }
      },
    },
    'Sign in with school email'
  )
  app.replaceChildren(
    h(
      'div',
      { class: 'screen signin' },
      h(
        'div',
        { class: 'signin-card' },
        h('img', { class: 'signin-logo', src: './icon-192.png', alt: '' }),
        h('h1', {}, CFG.APP_NAME),
        h('p', { class: 'muted' }, 'Your private notes and checklists, backed up to your school account.'),
        message ? h('p', { class: 'error' }, message) : '',
        btn,
        h('p', { class: 'fine' }, `You'll sign in with ${provider} using your school email${CFG.SCHOOL_EMAIL_DOMAIN ? ` (@${CFG.SCHOOL_EMAIL_DOMAIN})` : ''}.`),
        CFG.ALLOW_TEST_MODE
          ? h('button', { class: 'link-btn', onclick: startTest }, 'Try it without signing in (notes stay on this phone)')
          : ''
      )
    )
  )
}

// ================================================================ list screen

function showList() {
  leaveNote()
  view = 'list'
  const search = h('input', {
    class: 'search',
    type: 'search',
    placeholder: 'Search',
    value: query,
    autocomplete: 'off',
    enterkeyhint: 'search',
    oninput: (e) => {
      query = e.target.value
      renderListItems()
    },
  })
  ui = {}
  ui.list = h('div', { class: 'list' })
  ui.status = h('div', { class: 'tb-status' })
  app.replaceChildren(
    h(
      'div',
      { class: 'screen list-screen' },
      h(
        'header',
        { class: 'nav' },
        h('div', { class: 'nav-title' }, ''),
        h('button', { class: 'icon-btn', 'aria-label': 'Account', onclick: showAccountSheet }, icon('person'))
      ),
      h(
        'main',
        { class: 'scroller' },
        h('h1', { class: 'large-title' }, 'Notes'),
        account?.test
          ? h(
              'div',
              { class: 'banner' },
              'Test mode: these notes are saved on this phone only and are not backed up.',
              cloud || CFG.SUPABASE_URL ? h('button', { class: 'link-btn', onclick: leaveTest }, 'Sign in instead') : ''
            )
          : '',
        h('div', { class: 'search-wrap' }, icon('search'), search),
        ui.list
      ),
      h(
        'footer',
        { class: 'toolbar' },
        h('div', { class: 'tb-side' }),
        ui.status,
        h('button', { class: 'icon-btn accent', 'aria-label': 'New note', onclick: newNote }, icon('compose'))
      )
    )
  )
  renderListItems()
  renderStatus()
}

function renderListItems() {
  if (!ui.list) return
  const q = query.trim().toLowerCase()
  let notes = store.list()
  if (q) notes = notes.filter((n) => (n.title + '\n' + n.blocks.map((b) => b.text).join('\n')).toLowerCase().includes(q))
  if (!notes.length) {
    ui.list.replaceChildren(
      h(
        'div',
        { class: 'empty' },
        q ? 'No matching notes.' : h('span', {}, 'No notes yet.', h('br'), 'Tap ', icon('compose'), ' to write your first note.')
      )
    )
  } else {
    ui.list.replaceChildren(
      ...notes.map((n) =>
        h(
          'button',
          { class: 'note-row', onclick: () => openNote(n.id) },
          h('div', { class: 'row-title' }, noteHeading(n)),
          h('div', { class: 'row-meta' }, h('span', { class: 'row-date' }, shortDate(n.updatedAt)), h('span', { class: 'row-preview' }, notePreview(n)))
        )
      )
    )
  }
  renderStatus()
}

function showAccountSheet() {
  const close = () => sheet.remove()
  const sheet = h(
    'div',
    { class: 'sheet-backdrop', onclick: (e) => e.target === sheet && close() },
    h(
      'div',
      { class: 'sheet' },
      h('div', { class: 'sheet-title' }, account.test ? 'Test mode' : 'Signed in as'),
      h('div', { class: 'sheet-email' }, account.test ? 'Not signed in' : account.email || ''),
      h('div', { class: 'sheet-status' }, statusText()),
      account.test
        ? h('button', { class: 'sheet-btn', onclick: leaveTest }, 'Sign in with school email')
        : syncStatus === 'signin'
          ? h('button', { class: 'sheet-btn', onclick: () => window.__notesSignIn?.() }, 'Sign in again')
          : '',
      !account.test ? h('button', { class: 'sheet-btn danger', onclick: signOut }, 'Sign out') : '',
      h('button', { class: 'sheet-btn', onclick: close }, 'Close')
    )
  )
  app.append(sheet)
}

function leaveTest() {
  lsSet(TEST_MODE, null)
  account = null
  store = null
  cloud = null
  showSignIn()
}

async function signOut() {
  if (!cloud) return
  let unsynced = store.dirtyIds().length
  if (unsynced) {
    try {
      await cloud.sync.flush()
      unsynced = store.dirtyIds().length
    } catch {}
  }
  const msg = unsynced
    ? `${unsynced} note${unsynced > 1 ? 's have' : ' has'} not been backed up yet (no internet). If you sign out now, ${unsynced > 1 ? 'they' : 'it'} will be lost. Sign out anyway?`
    : 'Sign out? Your notes are backed up and will come back when you sign in again.'
  if (!(await ask(msg, 'Sign out', true))) return
  cloud.sync.stop()
  await cloud.sb.auth.signOut().catch(() => {})
  store.destroy() // remove her notes from this phone
  lsSet(LAST_USER, null)
  account = null
  store = null
  cloud = null
  syncStatus = ''
  showSignIn()
}

// ================================================================ note screen

function newNote() {
  leaveNote()
  const now = Date.now()
  current = { id: uuid(), title: '', blocks: [textBlock()], createdAt: now, updatedAt: now, deleted: false }
  current._unsaved = true
  showNote(true)
}

function openNote(id) {
  const n = store.get(id)
  if (!n) return
  current = n
  showNote(false)
}

// Save the open note. Called on every edit; the store batches the disk writes.
function saveCurrent() {
  if (!current) return
  if (current._unsaved && noteIsEmpty(current)) return // don't create blank notes
  const { _unsaved, ...note } = current
  current.updatedAt = store.put(note)
  delete current._unsaved
  if (ui.date) ui.date.textContent = longDate(current.updatedAt)
}

// Leaving a note: a note emptied of everything is removed, like Apple Notes.
function leaveNote() {
  if (view !== 'note' || !current) return
  if (noteIsEmpty(current) && !current._unsaved) store.remove(current.id)
  store.flush()
  current = null
  lastFocus = null
}

function showNote(isNew) {
  view = 'note'
  ui = {}
  ui.title = h('input', {
    class: 'note-title',
    placeholder: 'Title',
    value: current.title,
    maxlength: '300',
    autocapitalize: 'sentences',
    enterkeyhint: 'next',
    'aria-label': 'Title',
    oninput: (e) => {
      current.title = e.target.value
      saveCurrent()
    },
    onkeydown: (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        focusBlock(current.blocks[0].id, 0)
      }
    },
  })
  ui.date = h('div', { class: 'note-date' }, longDate(current.updatedAt))
  ui.blocks = h('div', { class: 'blocks' })
  ui.scroller = h('main', { class: 'scroller note-scroller', onclick: onScrollerTap }, ui.title, ui.date, ui.blocks, h('div', { class: 'tail' }))
  ui.status = h('div', { class: 'tb-status' })

  const keepFocus = (e) => e.preventDefault() // tapping toolbar buttons must not close the keyboard
  app.replaceChildren(
    h(
      'div',
      { class: 'screen note-screen' },
      h(
        'header',
        { class: 'nav' },
        h('button', { class: 'back-btn', onclick: showList }, icon('back'), 'Notes'),
        h(
          'div',
          { class: 'nav-actions' },
          h('button', { class: 'icon-btn', 'aria-label': 'Delete note', onclick: deleteCurrent }, icon('trash')),
          h('button', { class: 'text-btn done-btn', onclick: () => document.activeElement?.blur() }, 'Done')
        )
      ),
      ui.scroller,
      h(
        'footer',
        { class: 'toolbar' },
        h(
          'button',
          { class: 'icon-btn accent', 'aria-label': 'Checklist', title: 'Checklist', onpointerdown: keepFocus, onmousedown: keepFocus, onclick: toggleChecklist },
          icon('checklist')
        ),
        ui.status,
        h('button', { class: 'icon-btn accent', 'aria-label': 'New note', onpointerdown: keepFocus, onmousedown: keepFocus, onclick: newNote }, icon('compose'))
      )
    )
  )
  renderNoteBody()
  renderStatus()
  if (isNew) focusBlock(current.blocks[0].id, 0)
}

async function deleteCurrent() {
  if (!current) return
  if (!current._unsaved && !noteIsEmpty(current) && !(await ask('Delete this note?', 'Delete', true))) return
  if (!current._unsaved) store.remove(current.id)
  current = null
  showList()
}

// ---------------------------------------------------------------- blocks
// A note is a list of blocks: text blocks (any number of lines) and
// checklist items (one item each). Every block is a plain <textarea>, which
// by design cannot hold anything but text — no photos, files or drawings.

function renderNoteBody() {
  if (!ui.blocks) return
  if (ui.title && document.activeElement !== ui.title) ui.title.value = current.title
  const only = current.blocks.length === 1 && current.blocks[0].type === 'text'
  ui.blocks.replaceChildren(...current.blocks.map((b, i) => blockRow(b, only && i === 0)))
  autosizeAll()
}

function blockRow(b, withPlaceholder) {
  const ta = h('textarea', {
    class: 'block-input',
    rows: '1',
    'data-id': b.id,
    autocapitalize: 'sentences',
    spellcheck: 'true',
    placeholder: withPlaceholder ? 'Start writing…' : null,
    'aria-label': b.type === 'check' ? 'Checklist item' : 'Note text',
  })
  ta.value = b.text
  ta.addEventListener('input', () => {
    b.text = ta.value
    autosize(ta)
    saveCurrent()
    rememberFocus(b, ta)
    revealCaret(ta)
  })
  ta.addEventListener('keydown', (e) => onBlockKey(e, b, ta))
  ta.addEventListener('focus', () => {
    rememberFocus(b, ta)
    requestAnimationFrame(() => revealCaret(ta))
  })
  ta.addEventListener('keyup', () => rememberFocus(b, ta))
  ta.addEventListener('click', () => rememberFocus(b, ta))

  if (b.type !== 'check') return h('div', { class: 'block block-text' }, ta)

  const box = h('button', {
    class: 'checkbox' + (b.done ? ' on' : ''),
    role: 'checkbox',
    'aria-checked': b.done ? 'true' : 'false',
    'aria-label': 'Mark item done',
    onpointerdown: (e) => e.preventDefault(),
    onmousedown: (e) => e.preventDefault(),
    onclick: () => {
      b.done = !b.done
      row.classList.toggle('done', b.done)
      box.classList.toggle('on', b.done)
      box.setAttribute('aria-checked', b.done ? 'true' : 'false')
      saveCurrent()
    },
  })
  const row = h('div', { class: 'block block-check' + (b.done ? ' done' : '') }, box, ta)
  return row
}

document.addEventListener('selectionchange', () => {
  const el = document.activeElement
  if (view === 'note' && el?.classList?.contains('block-input')) {
    const b = current?.blocks.find((x) => x.id === el.dataset.id)
    if (b) rememberFocus(b, el)
  }
})

function rememberFocus(b, ta) {
  lastFocus = { id: b.id, start: ta.selectionStart, end: ta.selectionEnd }
}

function autosize(ta) {
  ta.style.height = 'auto'
  ta.style.height = ta.scrollHeight + 'px'
}
function autosizeAll() {
  ui.blocks?.querySelectorAll('textarea').forEach(autosize)
}

function focusBlock(id, offset) {
  const ta = ui.blocks?.querySelector(`textarea[data-id="${id}"]`)
  if (!ta) return
  const pos = offset == null ? ta.value.length : Math.min(offset, ta.value.length)
  ta.focus({ preventScroll: true })
  ta.setSelectionRange(pos, pos)
  const b = current.blocks.find((x) => x.id === id)
  if (b) rememberFocus(b, ta)
  requestAnimationFrame(() => revealCaret(ta))
}

function rerenderAndFocus(id, offset) {
  saveCurrent()
  renderNoteBody()
  focusBlock(id, offset)
}

// Turn block i into plain text and merge it with plain-text neighbours.
// `caret` is the caret offset inside block i; returns nothing (focuses).
function convertToText(i, caret) {
  const blocks = current.blocks
  const b = blocks[i]
  const prev = blocks[i - 1]?.type === 'text' ? blocks[i - 1] : null
  const next = blocks[i + 1]?.type === 'text' ? blocks[i + 1] : null
  const merged = textBlock((prev ? prev.text + '\n' : '') + b.text + (next ? '\n' + next.text : ''))
  const offset = (prev ? prev.text.length + 1 : 0) + caret
  blocks.splice(prev ? i - 1 : i, 1 + (prev ? 1 : 0) + (next ? 1 : 0), merged)
  rerenderAndFocus(merged.id, offset)
}

function onBlockKey(e, b, ta) {
  if (e.isComposing || e.keyCode === 229) return
  const blocks = current.blocks
  const i = blocks.indexOf(b)
  const start = ta.selectionStart
  const end = ta.selectionEnd

  if (b.type === 'check' && e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    if (!ta.value.trim()) return convertToText(i, 0) // Enter on an empty item ends the list
    const item = checkBlock(ta.value.slice(end))
    b.text = ta.value.slice(0, start)
    blocks.splice(i + 1, 0, item)
    return rerenderAndFocus(item.id, 0)
  }

  if (e.key === 'Backspace' && start === 0 && end === 0) {
    if (b.type === 'check') {
      e.preventDefault()
      return convertToText(i, 0) // Backspace at the start removes the checkbox
    }
    const prev = blocks[i - 1]
    if (prev) {
      e.preventDefault()
      // Join this block's first line onto the previous block.
      const nl = b.text.indexOf('\n')
      const first = nl < 0 ? b.text : b.text.slice(0, nl)
      const rest = nl < 0 ? null : b.text.slice(nl + 1)
      const offset = prev.text.length
      prev.text += first
      if (rest == null) blocks.splice(i, 1)
      else b.text = rest
      return rerenderAndFocus(prev.id, offset)
    }
  }
}

// The checklist button: turns the line(s) at the caret into checklist items,
// or turns a checklist item back into plain text.
function toggleChecklist() {
  const blocks = current.blocks
  let f = lastFocus && blocks.find((b) => b.id === lastFocus.id) ? lastFocus : null
  if (!f) {
    // Nothing focused: start a checklist at the end of the note.
    const last = blocks[blocks.length - 1]
    if (last.type === 'text' && !last.text.trim()) {
      blocks.splice(blocks.length - 1, 1)
    }
    const item = checkBlock()
    blocks.push(item)
    return rerenderAndFocus(item.id, 0)
  }
  const i = blocks.findIndex((b) => b.id === f.id)
  const b = blocks[i]
  if (b.type === 'check') return convertToText(i, f.start)

  const text = b.text
  const lineStart = text.lastIndexOf('\n', f.start - 1) + 1
  let lineEnd = text.indexOf('\n', f.end)
  if (lineEnd < 0) lineEnd = text.length
  const lines = text.slice(lineStart, lineEnd).split('\n')
  const replacement = []
  if (lineStart > 0) replacement.push(textBlock(text.slice(0, lineStart - 1)))
  const items = lines.map((l) => checkBlock(l))
  replacement.push(...items)
  if (lineEnd < text.length) replacement.push(textBlock(text.slice(lineEnd + 1)))
  blocks.splice(i, 1, ...replacement)
  const target = items[items.length - 1]
  const offset = items.length === 1 ? f.start - lineStart : target.text.length
  rerenderAndFocus(target.id, offset)
}

// Tapping the empty space below the note puts the caret at the end.
function onScrollerTap(e) {
  if (e.target !== ui.scroller && !e.target.classList.contains('tail') && e.target !== ui.blocks) return
  const blocks = current.blocks
  const last = blocks[blocks.length - 1]
  if (last.type === 'check' && last.text.trim()) {
    const t = textBlock()
    blocks.push(t)
    return rerenderAndFocus(t.id, 0)
  }
  focusBlock(last.id, null)
}

// Keep the line being typed visible above the keyboard/toolbar, even in
// very long notes. (Measures the caret with an invisible copy of the text.)
const mirror = h('div', { class: 'caret-mirror', 'aria-hidden': 'true' })
document.body.append(mirror)
function revealCaret(ta) {
  const sc = ui.scroller
  if (!sc || document.activeElement !== ta) return
  const cs = getComputedStyle(ta)
  for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth', 'boxSizing'])
    mirror.style[p] = cs[p]
  mirror.style.width = ta.offsetWidth + 'px'
  mirror.textContent = ta.value.slice(0, ta.selectionEnd)
  const marker = h('span', {}, '​')
  mirror.append(marker)
  const lineH = parseFloat(cs.lineHeight) || 24
  const caretTop = ta.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop + marker.offsetTop
  const viewTop = sc.scrollTop
  const viewBottom = sc.scrollTop + sc.clientHeight
  if (caretTop + lineH + 12 > viewBottom) sc.scrollTop = caretTop + lineH + 12 - sc.clientHeight
  else if (caretTop < viewTop + 4) sc.scrollTop = Math.max(0, caretTop - 8)
}

// ================================================================ dialogs

// In-app confirmation sheet (resolves true/false). Used instead of the
// browser's confirm(), which some app views suppress.
function ask(message, okLabel, danger) {
  return new Promise((resolve) => {
    const done = (v) => {
      sheet.remove()
      resolve(v)
    }
    const sheet = h(
      'div',
      { class: 'sheet-backdrop', onclick: (e) => e.target === sheet && done(false) },
      h(
        'div',
        { class: 'sheet', role: 'alertdialog' },
        h('div', { class: 'sheet-message' }, message),
        h('button', { class: 'sheet-btn' + (danger ? ' danger' : ''), onclick: () => done(true) }, okLabel),
        h('button', { class: 'sheet-btn', onclick: () => done(false) }, 'Cancel')
      )
    )
    document.activeElement?.blur?.()
    app.append(sheet)
  })
}

// ================================================================ toast

function toast(msg) {
  const t = h('div', { class: 'toast' }, msg)
  app.append(t)
  setTimeout(() => t.remove(), 5000)
}

// ================================================================ go

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}))
}

boot()
