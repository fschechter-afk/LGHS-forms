// Web Push subscribe/unsubscribe for the 📣 Announcements channel. See
// supabase/upgrade-push-notifications.sql for the server side.
//
// iOS note: push only works for the app installed to the home screen, on
// iOS 16.4+. A plain Safari tab has no pushManager at all — isPushSupported()
// covers that automatically since it checks for the API, not the platform.

import { VAPID_PUBLIC_KEY } from './config.js'
import { savePushSubscription, removePushSubscription } from './api.js'

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const base64safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64safe)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

export function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export function pushPermission() {
  return isPushSupported() ? Notification.permission : 'unsupported'
}

// Asks for permission (if needed) and registers the subscription with the
// server. Returns true on success; throws with a friendly message on
// failure so callers can show it directly.
export async function enablePush() {
  if (!isPushSupported()) throw new Error('Notifications are not supported in this browser.')

  let permission = Notification.permission
  if (permission === 'default') permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Notifications are blocked for this app. Enable them in your phone/browser settings.'
        : 'Notification permission was not granted.'
    )
  }

  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    })
  }
  await savePushSubscription(sub)
  return true
}

// Best-effort: unregisters the device's push subscription both from the
// browser and the server, e.g. on sign-out so a signed-out device stops
// receiving another account's announcements.
export async function disablePush() {
  if (!isPushSupported()) return
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return
    const endpoint = sub.endpoint
    await sub.unsubscribe().catch(() => {})
    await removePushSubscription(endpoint).catch(() => {})
  } catch {
    // Nothing to clean up, or the service worker never registered.
  }
}
