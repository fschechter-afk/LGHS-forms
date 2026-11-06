/* LGHS Notes service worker: lets the app open with no internet.
   Notes themselves live in the page's own storage, not here — this only
   caches the app's code. Never touches other apps' caches on this site. */
const PREFIX = 'lghs-notes-'
const CACHE = PREFIX + 'v1'
const SHELL = './'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll([SHELL, './manifest.webmanifest', './icon-192.png', './apple-touch-icon.png'])).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

function put(req, res) {
  if (res && res.ok) {
    const copy = res.clone()
    caches.open(CACHE).then((c) => c.put(req, copy))
  }
  return res
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // Supabase calls go straight to the network

  if (req.mode === 'navigate') {
    // Fresh copy when online (so updates arrive), saved copy when offline or slow.
    event.respondWith(
      new Promise((resolve) => {
        let done = false
        const fallback = () => caches.match(SHELL).then((hit) => hit && !done && ((done = true), resolve(hit)))
        const timer = setTimeout(fallback, 3500)
        fetch(req)
          .then((res) => {
            clearTimeout(timer)
            put(SHELL, res)
            if (!done) ((done = true), resolve(res))
          })
          .catch(() => {
            clearTimeout(timer)
            caches.match(SHELL).then((hit) => {
              if (!done) ((done = true), resolve(hit || Response.error()))
            })
          })
      })
    )
    return
  }

  // Build files have content hashes in their names: cached copy first.
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => put(req, res))))
})
