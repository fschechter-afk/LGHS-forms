// Stable per-person colour so each speaker in a group is recognisable at a
// glance. Picked from a fixed palette by hashing the user id, so the same
// person is always the same colour on every device.

const PALETTE = [
  '#53bdeb', // blue
  '#7fd4a8', // green
  '#f4a4ff', // violet
  '#ffd166', // amber
  '#ff9e80', // coral
  '#b3a4ff', // periwinkle
  '#8fe3d0', // teal
  '#ffb3c7', // pink
]

export function personColor(userId) {
  let hash = 0
  const s = String(userId || '')
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0
  return PALETTE[hash % PALETTE.length]
}

export function initials(name) {
  return String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('')
}
