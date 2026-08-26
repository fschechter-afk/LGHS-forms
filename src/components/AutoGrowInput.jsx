import React, { useEffect, useRef } from 'react'

/**
 * Single-line-in-meaning, multi-line-on-screen text box: the value never
 * contains newlines, but long text wraps and the box grows to fit so the
 * whole question stays visible instead of scrolling out of view sideways.
 */
export default function AutoGrowInput({ value, onChange, className = '', ...rest }) {
  const ref = useRef(null)

  const resize = () => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    // scrollHeight excludes borders, which a border-box height must include.
    const s = getComputedStyle(el)
    const borders = s.boxSizing === 'border-box'
      ? parseFloat(s.borderTopWidth) + parseFloat(s.borderBottomWidth)
      : 0
    el.style.height = el.scrollHeight + borders + 'px'
  }

  useEffect(resize, [value])

  return (
    <textarea
      ref={ref}
      className={`autogrow ${className}`.trim()}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/[\r\n]+/g, ' '))}
      onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }}
      {...rest}
    />
  )
}
