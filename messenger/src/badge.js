// Home screen app icon badge (Badging API) — shows how many chats have
// unread messages, without opening the app. Supported on installed PWAs
// (iOS home screen, Android, desktop Chrome/Edge); silently does nothing
// where it isn't.
import { call } from './api.js'
import { getLastRead } from './storage.js'

function isBadgingSupported() {
  return 'setAppBadge' in navigator
}

function countUnread(channels) {
  const lastRead = getLastRead()
  return channels.filter((ch) => ch.lastMsgAt > (lastRead[ch.id] || 0) && ch.lastMsgPreview).length
}

// Re-fetches the chat list and sets the badge to the number of chats with
// unread messages. Best effort — errors (offline, signed out, unsupported)
// are swallowed since the badge is a nice-to-have, never load-bearing.
export async function refreshBadge() {
  if (!isBadgingSupported()) return
  try {
    const data = await call('listChannels')
    const count = countUnread(data.channels)
    if (count > 0) await navigator.setAppBadge(count)
    else await navigator.clearAppBadge()
  } catch {
    // Not signed in, offline, or the API refused — leave the badge as-is.
  }
}

export async function clearBadge() {
  if (!isBadgingSupported()) return
  navigator.clearAppBadge().catch(() => {})
}
