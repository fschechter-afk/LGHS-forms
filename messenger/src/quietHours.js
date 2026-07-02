// Quiet hours are stored as "HH:MM-HH:MM" in settings (e.g. "21:30-07:00").
// A window that crosses midnight is handled by comparing both sides.

export function parseQuietHours(value) {
  const m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(String(value || '').trim())
  if (!m) return null
  return {
    start: Number(m[1]) * 60 + Number(m[2]),
    end: Number(m[3]) * 60 + Number(m[4]),
  }
}

export function inQuietHours(value, date = new Date()) {
  const window = parseQuietHours(value)
  if (!window) return false
  const minutes = date.getHours() * 60 + date.getMinutes()
  if (window.start <= window.end) return minutes >= window.start && minutes < window.end
  return minutes >= window.start || minutes < window.end
}
