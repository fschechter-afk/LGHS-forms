// Inline SVG icons (SF Symbols-like, drawn from scratch).
const svg = (body, vb = '0 0 24 24') =>
  `<svg viewBox="${vb}" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`

export const ICONS = {
  compose: svg('<path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6"/><path d="M17.6 3.4a2 2 0 0 1 2.9 2.9L12 14.8l-3.6.8.8-3.6z"/>'),
  checklist: svg('<circle cx="5.5" cy="6.5" r="2.5"/><path d="M4.4 6.6l.9.9 1.6-1.8"/><circle cx="5.5" cy="16.5" r="2.5"/><path d="M11 6.5h9M11 16.5h9"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>'),
  person: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3"/><path d="M6.2 18.4a7 7 0 0 1 11.6 0"/>'),
  search: svg('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.3-4.3"/>'),
  cloud: svg('<path d="M7 18a4 4 0 0 1-.6-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/>'),
}

export function icon(name) {
  const span = document.createElement('span')
  span.className = 'icon'
  span.innerHTML = ICONS[name]
  return span
}
