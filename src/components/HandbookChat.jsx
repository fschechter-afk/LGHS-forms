import React, { useEffect, useRef, useState } from 'react'
import { loadHandbook, parseSections, searchSections, askAI, isSampleHandbook } from '../handbook.js'

const SUGGESTIONS = [
  'What happens if I’m late to class?',
  'What is the cell phone policy?',
  'How do absences get excused?',
]

// AI chat over the school handbook. Two modes:
//  - AI mode: the question + the most relevant handbook sections go to the
//    Apps Script webhook, which calls Claude (API key stays in the script).
//  - Offline mode (no webhook / no key / request failed): the chat answers
//    directly with the matching handbook sections.
export default function HandbookChat({ endpoint, backHref = '#/' }) {
  const [sections, setSections] = useState(null)
  const [sample, setSample] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [aiDown, setAiDown] = useState(false) // remember a failed AI call and stop retrying
  const endRef = useRef(null)

  useEffect(() => {
    loadHandbook().then((text) => {
      setSample(isSampleHandbook(text))
      setSections(parseSections(text))
    })
  }, [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, busy])

  function offlineAnswer(hits) {
    if (!hits.length) {
      return {
        text: 'I couldn’t find anything about that in the handbook. Try different words, or ask the front office.',
        sources: [],
      }
    }
    return {
      text: 'Here’s what the handbook says about that:\n\n' +
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
    if (endpoint && !aiDown) {
      try {
        const answer = await askAI(endpoint, q, hits, history)
        reply = { text: answer, sources: hits, ai: true }
      } catch {
        setAiDown(true)
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
          <span className="brand-mark">LGHS</span> Handbook
        </div>
        <a className="btn ghost" href={backHref}>← Back</a>
      </header>

      {sample && (
        <div className="banner static">
          This chat is running on the <strong>sample</strong> handbook. Paste your
          school’s real handbook into <code>public/handbook.md</code> and redeploy.
        </div>
      )}

      <div className="card chat-card">
        <div className="chat-messages">
          {messages.length === 0 && (
            <div className="chat-welcome">
              <p>Ask me anything about the student handbook — attendance,
                grading, phones, dress code, and more.</p>
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
                  <summary>Handbook sections used</summary>
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
            placeholder={sections ? 'Ask about the handbook…' : 'Loading handbook…'}
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
        Answers come from the student handbook{endpoint && !aiDown ? ' with AI help' : ''}.
        Double-check anything important with school staff.
      </p>
    </div>
  )
}
