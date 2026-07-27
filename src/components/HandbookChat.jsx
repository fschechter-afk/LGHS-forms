import React, { useEffect, useRef, useState } from 'react'
import {
  loadHandbook, parseSections, searchSections, askAI, isSampleHandbook,
  loadKnowledge, knowledgeSections,
} from '../handbook.js'

const SUGGESTIONS = [
  'What happens if I’m late to class?',
  'What is the cell phone policy?',
  'How do absences get excused?',
]

// The LGHS Chatbox: an AI assistant for the school handbook plus any extra
// info staff have added from the Settings page. Questions go to the Apps
// Script webhook with the FULL handbook, so Claude can combine information
// from different parts of it (the API key stays in the script). If AI is
// unreachable (no webhook, no key, offline), the chatbox falls back to
// showing the handbook sections that best match the question.
export default function HandbookChat({ endpoint, backHref = '#/' }) {
  const owner = backHref === '#/' // opened from the owner's app, not a shared link
  const [handbook, setHandbook] = useState('') // full text, sent to the AI
  const [sections, setSections] = useState(null) // parsed, for fallback + sources
  const [sample, setSample] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [noKey, setNoKey] = useState(false) // script has no API key: stop retrying AI
  const endRef = useRef(null)

  useEffect(() => {
    Promise.all([loadHandbook(), loadKnowledge(endpoint)]).then(([text, entries]) => {
      setSample(isSampleHandbook(text))
      const extras = knowledgeSections(entries)
      setHandbook(text + (extras.length
        ? '\n\n# School updates\n\n' + extras.map((s) => `## ${s.title}\n${s.body}`).join('\n\n')
        : ''))
      setSections([...parseSections(text), ...extras])
    })
  }, [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, busy])

  function offlineAnswer(hits) {
    if (!hits.length) {
      return {
        text: 'The AI isn’t reachable right now, and I couldn’t find a matching handbook section either. Try different words, or ask the front office.',
        sources: [],
      }
    }
    return {
      text: 'The AI isn’t reachable right now, so here are the handbook sections that best match your question:\n\n' +
        hits.map((s) => `${s.crumb}\n${s.body}`).join('\n\n'),
      sources: hits,
    }
  }

  async function ask(question) {
    const q = question.trim()
    if (!q || busy || !sections) return
    const history = messages
    setMessages((m) => [...m, { role: 'user', text: q }])
    setInput('')
    setBusy(true)

    const hits = searchSections(sections, q, 4)
    let reply
    if (endpoint && !noKey) {
      try {
        const answer = await askAI(endpoint, q, handbook, history)
        reply = { text: answer, sources: hits, ai: true }
      } catch (err) {
        // 'no-key' is permanent (script not configured); anything else is
        // transient, so the next question tries the AI again.
        if (err.message === 'no-key') setNoKey(true)
        reply = offlineAnswer(hits)
      }
    } else {
      reply = offlineAnswer(hits)
    }
    setMessages((m) => [...m, { role: 'assistant', ...reply }])
    setBusy(false)
  }

  return (
    <div className="page fill-page chat-page">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">LGHS</span> Chatbox
        </div>
        <a className="btn ghost" href={backHref}>← Back</a>
      </header>

      {sample && (
        <div className="banner static">
          The chatbox is running on the <strong>sample</strong> handbook. Paste your
          school’s real handbook into <code>public/handbook.md</code> and redeploy.
        </div>
      )}

      {owner && !endpoint && (
        <div className="banner static">
          AI answers aren’t set up yet — connect Google Sheets in{' '}
          <a href="#/settings">⚙ Sheets setup</a> so questions can reach the AI.
        </div>
      )}
      {owner && noKey && (
        <div className="banner static">
          AI answers aren’t enabled yet: add an <code>ANTHROPIC_API_KEY</code>{' '}
          Script Property to your Apps Script (see <a href="#/settings">⚙ Sheets setup</a>).
          Until then the chatbox only quotes matching sections.
        </div>
      )}

      <div className="card chat-card">
        <div className="chat-messages">
          {messages.length === 0 && (
            <div className="chat-welcome">
              <p>Hi! I’m the LGHS Chatbox, an AI assistant for students and
                parents. Ask me anything about the student handbook and school
                info — attendance, grading, phones, dress code, and more — and
                I’ll pull together an answer from across the handbook.</p>
              <div className="chat-suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="btn small" onClick={() => ask(s)} disabled={!sections}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`chat-bubble ${m.role}`}>
              <div className="chat-text">{m.text}</div>
              {m.role === 'assistant' && m.sources?.length > 0 && m.ai && (
                <details className="chat-sources">
                  <summary>Related handbook sections</summary>
                  {m.sources.map((s, j) => (
                    <div key={j} className="chat-source">
                      <div className="chat-source-title">{s.crumb}</div>
                      <div className="chat-source-body">{s.body}</div>
                    </div>
                  ))}
                </details>
              )}
            </div>
          ))}

          {busy && <div className="chat-bubble assistant chat-typing">Thinking…</div>}
          <div ref={endRef} />
        </div>

        <form
          className="chat-input-row"
          onSubmit={(e) => {
            e.preventDefault()
            ask(input)
          }}
        >
          <input
            className="fill-input"
            placeholder={sections ? 'Ask the LGHS Chatbox…' : 'Loading…'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={!sections}
          />
          <button className="btn primary" type="submit" disabled={busy || !input.trim() || !sections}>
            Ask
          </button>
        </form>
      </div>

      <p className="muted small chat-footnote">
        AI answers are based on the student handbook and school updates.
        Double-check anything important with school staff.
      </p>
    </div>
  )
}
