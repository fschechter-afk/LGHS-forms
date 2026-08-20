import React, { useState } from 'react'
import { signedImageUrl } from '../api.js'

function prettySize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return '1 KB' // don't render a tiny file as "0 KB"
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

// PDFs and other documents. The signed URL is minted on tap rather than up
// front, so opening a channel doesn't sign every attachment in its history.
export default function FileBubble({ message }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const name = message.data?.name || 'Document'
  const size = prettySize(message.data?.size)

  const open = async () => {
    if (busy) return
    setBusy(true)
    setError(false)
    try {
      const url = await signedImageUrl(message.data.path)
      window.open(url, '_blank', 'noopener')
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="file-wrap">
      <button className="file-card" onClick={open} disabled={busy}>
        <span className="file-icon">📄</span>
        <span className="file-meta">
          <span className="file-name">{name}</span>
          <span className="file-sub">{busy ? 'Opening…' : error ? 'Could not open' : size || 'PDF'}</span>
        </span>
      </button>
      {message.text && <div className="bubble-text image-caption">{message.text}</div>}
    </div>
  )
}
