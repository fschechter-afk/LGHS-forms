import React from 'react'

// Reading view for a post, as the girls see it.
export default function NoteView({ note, onBack, backHref }) {
  if (!note) {
    return (
      <div className="page fill-page">
        <div className="card">
          <p>This link is invalid or the post is no longer shared.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page fill-page">
      {(onBack || backHref) && (
        <header className="topbar">
          {onBack
            ? <button className="btn ghost" onClick={onBack}>← All posts</button>
            : <a className="btn ghost" href={backHref}>← Back</a>}
        </header>
      )}

      <div className="card form-header-card">
        <h1 className="note-title">{note.title || 'Untitled post'}</h1>
      </div>

      <div className="card">
        <div className="note-body">{note.body}</div>
      </div>
    </div>
  )
}
