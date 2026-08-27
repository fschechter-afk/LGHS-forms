// LGHS Dorm Messenger service worker: cache the app shell so the PWA opens
// offline. API calls (Apps Script) are network-only — messages come from the
// outbox queue in the app itself when offline.
const CACHE = 'lghs-messenger-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(['./', './index.html'])).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== location.origin) return

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone()
        caches.open(CACHE).then((cache) => cache.put(event.request, copy))
        return res
      })
      .catch(() =>
        caches.match(event.request).then((hit) => hit || caches.match('./index.html'))
      )
  )
})

// Announcement pushes only (see upgrade-push-notifications.sql) — DMs and
// groups never reach here, so there's no need to branch on message type.
self.addEventListener('push', (event) => {
  let payload = { title: '📣 LGHS Announcements', body: 'New announcement', url: './' }
  try {
    if (event.data) payload = { ...payload, ...event.data.json() }
  } catch {
    // Malformed payload: fall back to the generic text above rather than
    // dropping the notification silently.
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: './icon-192.png',
      badge: './icon-192.png',
      data: { url: payload.url || './' },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || './', self.location.href).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          client.navigate(target)
          return client.focus()
        }
      }
      return self.clients.openWindow(target)
    })
  )
})
