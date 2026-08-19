import React from 'react'

// Renders both regular polls and faculty check-ins (a one-option poll whose
// results read as an attendance list).
export default function PollCard({ message, votes, onVote }) {
  const options = message.data?.options || []
  const counts = votes?.counts || {}
  const voters = votes?.voters || {}
  const mine = votes?.mine ?? null
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  const isCheckin = message.kind === 'checkin'

  return (
    <div className="poll-card">
      <div className="poll-question">
        {isCheckin ? '🙋 ' : '📊 '}
        {message.text}
      </div>
      {options.map((opt, i) => {
        const count = counts[i] || 0
        const pct = total > 0 ? Math.round((count / total) * 100) : 0
        const chosen = mine === i
        return (
          <button
            key={i}
            className={'poll-option' + (chosen ? ' chosen' : '')}
            onClick={() => onVote(i)}
          >
            <span className="poll-bar" style={{ width: pct + '%' }} />
            <span className="poll-option-label">
              {chosen ? '● ' : '○ '}
              {opt}
            </span>
            <span className="poll-count">{isCheckin ? count : count + ' · ' + pct + '%'}</span>
          </button>
        )
      })}
      {isCheckin ? (
        <div className="poll-footer">
          {total === 0 ? 'Waiting for check-ins…' : 'Checked in: ' + (voters[0] || []).join(', ')}
        </div>
      ) : (
        <div className="poll-footer">
          {total} vote{total === 1 ? '' : 's'} · tap to vote, tap again to switch
        </div>
      )}
    </div>
  )
}
