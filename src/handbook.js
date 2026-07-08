// Handbook loading, section parsing, and lightweight retrieval for the
// handbook chat. The handbook itself is a Markdown file shipped with the app
// (public/handbook.md) so it works offline and needs no backend.

import { encodeText } from './storage.js'
import { sendToSheets } from './sheets.js'

const CACHE_KEY = 'lghsforms.handbook'
const KNOWLEDGE_CACHE_KEY = 'lghsforms.knowledge'
const SAMPLE_MARKER = 'SAMPLE HANDBOOK'

let memo = null

// Fetch the handbook (network first so edits land, localStorage when offline).
export async function loadHandbook() {
  if (memo !== null) return memo
  try {
    const res = await fetch('./handbook.md', { cache: 'no-cache' })
    if (!res.ok) throw new Error('handbook fetch failed')
    memo = await res.text()
    try {
      localStorage.setItem(CACHE_KEY, memo)
    } catch {}
  } catch {
    memo = localStorage.getItem(CACHE_KEY) || ''
  }
  return memo
}

export function isSampleHandbook(text) {
  return text.includes(SAMPLE_MARKER)
}

// ---- Extra info ("school updates") ----
// Staff can keep adding information from the Settings page without touching
// handbook.md or redeploying. Entries live in a hidden tab of the Google
// Sheet; the chatbox fetches them fresh on every visit and keeps the last
// copy in localStorage for offline use.

export async function loadKnowledge(endpoint) {
  if (!endpoint) return []
  try {
    const url = endpoint + (endpoint.includes('?') ? '&' : '?') + 'knowledge=1'
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok) throw new Error('knowledge fetch failed')
    const body = await res.json()
    if (!body.ok) throw new Error(body.error || 'knowledge error')
    const entries = body.entries || []
    try {
      localStorage.setItem(KNOWLEDGE_CACHE_KEY, JSON.stringify(entries))
    } catch {}
    return entries
  } catch {
    try {
      return JSON.parse(localStorage.getItem(KNOWLEDGE_CACHE_KEY)) || []
    } catch {
      return []
    }
  }
}

// Turn stored entries into sections shaped like handbook sections, so the
// same retrieval and citation code covers both.
export function knowledgeSections(entries) {
  return entries
    .filter((e) => e.text)
    .map((e) => ({
      title: e.title || 'School update',
      crumb: `School updates › ${e.title || 'Update'}`,
      body: e.text,
    }))
}

export async function addKnowledge(endpoint, { id, title, text }, key) {
  const res = await sendToSheets(endpoint, { action: 'addinfo', id, title, text, key: key || '' })
  const body = await res.json().catch(() => ({}))
  if (!body.ok) throw new Error(body.error || 'Could not save')
  return body.id
}

export async function removeKnowledge(endpoint, id, key) {
  const res = await sendToSheets(endpoint, { action: 'removeinfo', id, key: key || '' })
  const body = await res.json().catch(() => ({}))
  if (!body.ok) throw new Error(body.error || 'Could not delete')
}

// Split the Markdown into sections keyed by their heading trail, so answers
// can cite "Attendance › Tardies" instead of a bare blob of text.
export function parseSections(markdown) {
  const clean = markdown.replace(/<!--[\s\S]*?-->/g, '')
  const lines = clean.split('\n')
  const sections = []
  const trail = [] // current heading per level
  let current = null

  for (const line of lines) {
    const m = line.match(/^(#{1,4})\s+(.*)/)
    if (m) {
      const level = m[1].length
      trail.length = level - 1
      trail[level - 1] = m[2].trim()
      current = { title: m[2].trim(), crumb: trail.filter(Boolean).join(' › '), body: '' }
      sections.push(current)
    } else if (current) {
      current.body += line + '\n'
    } else if (line.trim()) {
      current = { title: 'Handbook', crumb: 'Handbook', body: line + '\n' }
      sections.push(current)
    }
  }
  return sections.map((s) => ({ ...s, body: s.body.trim() })).filter((s) => s.body)
}

const STOP = new Set([
  'the', 'and', 'for', 'are', 'can', 'you', 'your', 'what', 'when', 'where',
  'how', 'who', 'why', 'does', 'about', 'with', 'have', 'has', 'this', 'that',
  'not', 'get', 'was', 'were', 'will', 'from', 'they', 'their', 'them', 'its',
  'his', 'her', 'our', 'out', 'all', 'any', 'may', 'should', 'would', 'could',
])

function tokens(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w))
    // rough singularizer so "tardies" matches "tardy" and "phones" matches "phone"
    .map((w) => (w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.endsWith('ss') ? w : w.replace(/s$/, '')))
}

// Rank sections against a question. Title matches count more than body
// matches; scores are dampened by section length so long sections don't win
// on volume alone.
export function searchSections(sections, query, limit = 4) {
  const qTokens = [...new Set(tokens(query))]
  if (!qTokens.length) return []

  const scored = sections.map((s) => {
    const titleText = tokens(s.crumb).join(' ')
    const bodyText = tokens(s.body).join(' ')
    let score = 0
    for (const t of qTokens) {
      const inTitle = titleText.split(t).length - 1
      const inBody = bodyText.split(t).length - 1
      score += inTitle * 5 + Math.min(inBody, 5)
    }
    return { section: s, score: score / Math.log2(16 + bodyText.length / 40) }
  })

  const ranked = scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score)
  // Keep only sections in the same league as the best match, so a question
  // about phones doesn't drag in the grading scale.
  const cutoff = ranked.length ? ranked[0].score * 0.35 : 0
  return ranked
    .filter((x) => x.score >= cutoff)
    .slice(0, limit)
    .map((x) => x.section)
}

// Ask the Apps Script webhook to answer with AI (it holds the Claude API key
// in Script Properties, so the key never ships to students' devices).
// The FULL handbook goes along so Claude can combine information from
// different parts of it; the script adds the school updates itself from the
// Sheet. Throws Error('no-key') when the script has no key configured.
export async function askAI(endpoint, question, handbookText, history) {
  const res = await sendToSheets(endpoint, {
    action: 'ask',
    question,
    handbook: handbookText.slice(0, 400000),
    history: history.slice(-6).map((m) => ({ role: m.role, text: m.text })),
  })
  const body = await res.json().catch(() => ({}))
  if (!body.ok) throw new Error(body.error || 'AI request failed')
  return body.answer
}

// Sharable link to the chat that carries the webhook URL, like the hub link.
export function chatLink(endpoint) {
  return `${location.origin}${location.pathname}#/chat/${encodeText(endpoint || '')}`
}
