import React, { useEffect, useState } from 'react'
import { signedImageUrl } from '../api.js'

// Attachments live in a private bucket, so each image is fetched through a
// short-lived signed URL rather than a public link.
export default function ImageBubble({ message, onOpen }) {
  const path = message.data?.path
  const [url, setUrl] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!path) return
    let cancelled = false
    signedImageUrl(path)
      .then((u) => !cancelled && setUrl(u))
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
    }
  }, [path])

  // Reserve the right amount of space up front so the chat doesn't jump
  // around as images load.
  const w = message.data?.w || 0
  const h = message.data?.h || 0
  const ratio = w && h ? w / h : 4 / 3

  if (failed) return <div className="image-failed">📷 Image unavailable</div>

  return (
    <div className="image-wrap">
      <div className="image-frame" style={{ aspectRatio: String(ratio) }}>
        {url ? (
          <img
            src={url}
            alt={message.text || 'Shared photo'}
            onClick={() => onOpen(url)}
            onError={() => setFailed(true)}
          />
        ) : (
          <div className="image-loading">Loading…</div>
        )}
      </div>
      {message.text && <div className="bubble-text image-caption">{message.text}</div>}
    </div>
  )
}
