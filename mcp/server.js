#!/usr/bin/env node
// LGHS Forms MCP server.
//
// Lets Claude (Claude Desktop, Claude Code, any MCP client) manage the same
// things the app's owner device does, by talking to the school's Apps Script
// web app — the one apps-script/Code.gs deploys:
//   - the student hub: list, publish, update and unpublish forms and posts
//   - the chatbox's school updates (the hidden "_Chatbox Info" tab)
//   - asking the LGHS Chatbox a question, and sending a test/real submission
//
// Configuration (environment variables):
//   LGHS_WEBHOOK_URL  required — the Apps Script web app URL (ends in /exec)
//   LGHS_PUBLISH_KEY  optional — same value as PUBLISH_KEY in Code.gs
//   LGHS_SITE_URL     optional — where the app is deployed, for share links
//                     (default https://fschechter-afk.github.io/LGHS-forms/)
//   LGHS_HANDBOOK     optional — path to the handbook Markdown used by
//                     ask_chatbox (default ../public/handbook.md)

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { readFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ENDPOINT = (process.env.LGHS_WEBHOOK_URL || '').trim()
const PUBLISH_KEY = process.env.LGHS_PUBLISH_KEY || ''
const SITE_URL = (process.env.LGHS_SITE_URL || 'https://fschechter-afk.github.io/LGHS-forms/').replace(/\/?$/, '/')
const HANDBOOK_PATH = process.env.LGHS_HANDBOOK ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'handbook.md')

// Same limits and shapes as the app (src/storage.js).
const NOTE_MAX_CHARS = 40000
const QUESTION_TYPES = ['short', 'paragraph', 'choice', 'checkbox', 'dropdown', 'scale', 'date', 'time']
const OPTION_TYPES = new Set(['choice', 'checkbox', 'dropdown'])

// Matches uid() in src/storage.js so ids look like the app's own.
const uid = () => randomBytes(4).toString('hex').slice(0, 6) + Date.now().toString(36)

// URL-safe base64, identical to encodeText() in src/storage.js.
const encodeText = (text) =>
  Buffer.from(text, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

// ---- Apps Script calls ----

function requireEndpoint() {
  if (!ENDPOINT) {
    throw new Error('LGHS_WEBHOOK_URL is not set. Set it to your Apps Script web app URL (ends in /exec).')
  }
}

async function readJson(res, what) {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(
      `${what} failed — the Apps Script didn't reply with data (HTTP ${res.status}). ` +
      'In Apps Script check Deploy → Manage deployments: "Who has access" must be Anyone.'
    )
  }
}

// POSTs as text/plain, like the app, and insists on a JSON { ok: true }.
async function post(payload, what) {
  requireEndpoint()
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
    redirect: 'follow',
  })
  const body = await readJson(res, what)
  if (body.ok !== true) throw new Error(body.error || `${what} failed`)
  return body
}

async function get(param, what) {
  requireEndpoint()
  const url = ENDPOINT + (ENDPOINT.includes('?') ? '&' : '?') + param
  const res = await fetch(url, { redirect: 'follow' })
  const body = await readJson(res, what)
  if (body.ok !== true) throw new Error(body.error || `${what} failed`)
  return body
}

const listHub = async () => (await get('list=1', 'Loading the hub')).forms || []
const listInfo = async () => (await get('knowledge=1', 'Loading chatbox info')).entries || []

// Publishes, then reads the hub back: an out-of-date Code.gs treats an unknown
// action as a plain submission and still answers ok (see src/sheets.js).
async function publishItem(item) {
  await post({ action: 'publish', key: PUBLISH_KEY, form: item }, 'Publishing')
  const forms = await listHub().catch(() => null)
  if (forms && !forms.some((f) => f.id === item.id)) {
    throw new Error(
      'The script accepted it but the item is not on the hub, so the deployed Apps Script is an ' +
      'older version. Paste the latest apps-script/Code.gs and redeploy (Manage deployments → Edit → New version).'
    )
  }
}

// ---- Links ----

const hubLink = () => `${SITE_URL}#/hub/${encodeText(ENDPOINT)}`
const chatLink = () => `${SITE_URL}#/chat/${encodeText(ENDPOINT)}`
const formLink = (f) => `${SITE_URL}#/fill/${encodeText(JSON.stringify({
  id: f.id, title: f.title, description: f.description, questions: f.questions, endpoint: ENDPOINT,
}))}`
const noteLink = (n) => `${SITE_URL}#/read/${encodeText(JSON.stringify({
  id: n.id, kind: 'note', title: n.title, body: n.body,
}))}`
const itemLink = (item) => (item.kind === 'note' ? noteLink(item) : formLink(item))

// ---- Schemas ----

const questionSchema = z.object({
  id: z.string().optional().describe('Keep the existing id when editing a published form, so Sheet columns line up.'),
  type: z.enum(QUESTION_TYPES).describe('short, paragraph, choice (multiple choice), checkbox, dropdown, scale, date, time'),
  label: z.string().min(1).describe('The question text. It becomes the Sheet column header.'),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional().describe('Required for choice, checkbox and dropdown.'),
  min: z.number().int().optional().describe('scale only (default 1)'),
  max: z.number().int().optional().describe('scale only (default 5)'),
  minLabel: z.string().optional(),
  maxLabel: z.string().optional(),
})

function normalizeQuestion(q) {
  const out = { id: q.id || uid(), type: q.type, label: q.label, required: !!q.required }
  if (OPTION_TYPES.has(q.type)) {
    const options = (q.options || []).map((o) => o.trim()).filter(Boolean)
    if (!options.length) throw new Error(`Question "${q.label}" (${q.type}) needs at least one option.`)
    out.options = options
  }
  if (q.type === 'scale') {
    out.min = q.min ?? 1
    out.max = q.max ?? 5
    if (out.max <= out.min) throw new Error(`Question "${q.label}": max must be greater than min.`)
    out.minLabel = q.minLabel || ''
    out.maxLabel = q.maxLabel || ''
  }
  return out
}

// ---- Server ----

const server = new McpServer({ name: 'lghs-forms', version: '1.0.0' })

const text = (value) => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
})

// Turns thrown errors into readable tool errors instead of protocol failures.
const tool = (fn) => async (args) => {
  try {
    return await fn(args)
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: String(err?.message || err) }] }
  }
}

server.registerTool('check_connection', {
  title: 'Check connection',
  description: 'Checks that the Apps Script web app is reachable and reports the hub and chatbox links.',
  inputSchema: {},
  annotations: { readOnlyHint: true },
}, tool(async () => {
  const body = await get('ping=1', 'Connecting')
  const forms = await listHub()
  return text({
    service: body.service || 'ok',
    publishedItems: forms.length,
    publishKeyConfigured: !!PUBLISH_KEY,
    hubLink: hubLink(),
    chatboxLink: chatLink(),
  })
}))

server.registerTool('list_hub', {
  title: 'List hub items',
  description: 'Lists every form and post currently published on the student hub, newest first.',
  inputSchema: {
    includeContent: z.boolean().optional().describe('Include full questions/post body (default false: summary only).'),
  },
  annotations: { readOnlyHint: true },
}, tool(async ({ includeContent }) => {
  const forms = await listHub()
  return text(forms.map((f) => includeContent ? { ...f, link: itemLink(f) } : {
    id: f.id,
    kind: f.kind || 'form',
    title: f.title,
    accepting: f.accepting !== false,
    questions: f.kind === 'note' ? undefined : (f.questions || []).length,
    publishedAt: f.publishedAt ? new Date(f.publishedAt).toISOString() : undefined,
  }))
}))

server.registerTool('get_hub_item', {
  title: 'Get hub item',
  description: 'Returns one published form or post in full, with its direct share link.',
  inputSchema: { id: z.string() },
  annotations: { readOnlyHint: true },
}, tool(async ({ id }) => {
  const item = (await listHub()).find((f) => f.id === id)
  if (!item) throw new Error(`Nothing with id "${id}" is published on the hub.`)
  return text({ ...item, link: itemLink(item) })
}))

server.registerTool('publish_form', {
  title: 'Publish form',
  description:
    'Creates a form and publishes it to the student hub, or replaces a published one when id is given. ' +
    'Responses go to a Sheet tab named after the form title; each question label becomes a column.',
  inputSchema: {
    id: z.string().optional().describe('Id of a published form to replace. Omit to create a new form.'),
    title: z.string().min(1),
    description: z.string().optional().describe('Introduction paragraph shown above the questions.'),
    accepting: z.boolean().optional().describe('Whether it accepts responses (default true).'),
    questions: z.array(questionSchema).min(1),
  },
}, tool(async ({ id, title, description, accepting, questions }) => {
  const form = {
    id: id || uid(),
    kind: 'form',
    title: title.trim(),
    description: description || '',
    accepting: accepting !== false,
    questions: questions.map(normalizeQuestion),
  }
  await publishItem(form)
  return text({ published: true, replaced: !!id, id: form.id, title: form.title, link: formLink(form), hubLink: hubLink() })
}))

server.registerTool('publish_post', {
  title: 'Publish post',
  description:
    'Publishes a post (a write-up or announcement to read, not fill in) to the student hub, or replaces one when id is given. ' +
    'The body is Markdown-style plain text.',
  inputSchema: {
    id: z.string().optional().describe('Id of a published post to replace. Omit to create a new post.'),
    title: z.string().min(1),
    body: z.string().min(1).max(NOTE_MAX_CHARS),
  },
}, tool(async ({ id, title, body }) => {
  const note = { id: id || uid(), kind: 'note', title: title.trim(), body, accepting: true }
  await publishItem(note)
  return text({ published: true, replaced: !!id, id: note.id, title: note.title, link: noteLink(note), hubLink: hubLink() })
}))

server.registerTool('set_accepting', {
  title: 'Open or close a form',
  description: 'Opens or closes a published form for responses, keeping everything else the same.',
  inputSchema: { id: z.string(), accepting: z.boolean() },
}, tool(async ({ id, accepting }) => {
  const item = (await listHub()).find((f) => f.id === id)
  if (!item) throw new Error(`Nothing with id "${id}" is published on the hub.`)
  const { publishedAt, ...rest } = item
  await publishItem({ ...rest, accepting })
  return text({ id, title: item.title, accepting })
}))

server.registerTool('unpublish', {
  title: 'Unpublish',
  description: 'Removes a form or post from the student hub. Responses already in the Sheet are kept.',
  inputSchema: { id: z.string() },
  annotations: { destructiveHint: true },
}, tool(async ({ id }) => {
  await post({ action: 'unpublish', key: PUBLISH_KEY, formId: id }, 'Unpublishing')
  return text({ unpublished: true, id })
}))

server.registerTool('list_chatbox_info', {
  title: 'List chatbox info',
  description: 'Lists the school updates the LGHS Chatbox answers from, in addition to the handbook.',
  inputSchema: {},
  annotations: { readOnlyHint: true },
}, tool(async () => {
  const entries = await listInfo()
  return text(entries.map((e) => ({ ...e, addedAt: e.addedAt ? new Date(e.addedAt).toISOString() : undefined })))
}))

server.registerTool('add_chatbox_info', {
  title: 'Add chatbox info',
  description:
    'Adds a school update the chatbox will use immediately (announcements, schedule changes, clarifications), ' +
    'or replaces one when id is given. If an update and the handbook disagree, the chatbox prefers the update.',
  inputSchema: {
    id: z.string().optional().describe('Id of an existing entry to replace.'),
    title: z.string().max(200).describe('Short topic, used for finding and citing it.'),
    text: z.string().min(1).max(20000),
  },
}, tool(async ({ id, title, text: info }) => {
  const body = await post({ action: 'addinfo', key: PUBLISH_KEY, id, title, text: info }, 'Adding info')
  return text({ saved: true, id: body.id || id })
}))

server.registerTool('remove_chatbox_info', {
  title: 'Remove chatbox info',
  description: 'Removes a school update from the chatbox.',
  inputSchema: { id: z.string() },
  annotations: { destructiveHint: true },
}, tool(async ({ id }) => {
  await post({ action: 'removeinfo', key: PUBLISH_KEY, id }, 'Removing info')
  return text({ removed: true, id })
}))

server.registerTool('ask_chatbox', {
  title: 'Ask the chatbox',
  description:
    'Asks the LGHS Chatbox a question exactly as a student or parent would, to check its answers. ' +
    'Needs ANTHROPIC_API_KEY set in the Apps Script. The question is logged in the "Chatbox Questions" tab.',
  inputSchema: { question: z.string().min(1).max(2000) },
}, tool(async ({ question }) => {
  let handbook
  try {
    handbook = await readFile(HANDBOOK_PATH, 'utf8')
  } catch {
    throw new Error(`Could not read the handbook at ${HANDBOOK_PATH}. Set LGHS_HANDBOOK to its path.`)
  }
  try {
    const body = await post({ action: 'ask', question, handbook, history: [] }, 'Asking')
    return text(body.answer)
  } catch (err) {
    if (String(err.message) === 'no-key') {
      throw new Error('AI answers are off: add ANTHROPIC_API_KEY under Apps Script → Project Settings → Script Properties.')
    }
    throw err
  }
}))

server.registerTool('submit_response', {
  title: 'Submit a response',
  description:
    'Appends one response row to a form\'s Sheet tab, as if someone filled it in. ' +
    'Use for test rows or entering a paper response. Answers are keyed by question label.',
  inputSchema: {
    formTitle: z.string().min(1).describe('The form title (= the Sheet tab name).'),
    answers: z.record(z.string(), z.union([z.string(), z.array(z.string())]))
      .describe('Question label → answer. Checkbox answers may be a list.'),
  },
}, tool(async ({ formTitle, answers }) => {
  await post({
    formTitle,
    submittedAt: new Date().toISOString(),
    answers: Object.entries(answers).map(([question, answer]) => ({
      question,
      answer: Array.isArray(answer) ? answer.join(', ') : answer,
    })),
  }, 'Submitting')
  return text({ submitted: true, tab: formTitle })
}))

server.registerResource('handbook', 'lghs://handbook', {
  title: 'Student handbook',
  description: 'The handbook Markdown the chatbox answers from (public/handbook.md).',
  mimeType: 'text/markdown',
}, async (uri) => ({
  contents: [{ uri: uri.href, mimeType: 'text/markdown', text: await readFile(HANDBOOK_PATH, 'utf8') }],
}))

await server.connect(new StdioServerTransport())
