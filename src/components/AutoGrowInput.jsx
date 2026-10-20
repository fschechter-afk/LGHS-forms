import React, { useEffect, useRef } from 'react'

/**
 * Text box that wraps and grows to fit, so long text stays visible instead of
 * scrolling out of view sideways.
 *
 * By default the value is single-line in meaning: newlines are stripped and
 * Enter does nothing, which suits a question or a title. Pass `multiline` for
 * prose — an intro paragraph — where Enter starts a new line as expected.
 */
export default function AutoGrowInput({ value, onChange, className = '', multiline = false, ...rest }) {
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
      onChange={(e) => onChange(multiline ? e.target.value : e.target.value.replace(/[\r\n]+/g, ' '))}
      onKeyDown={(e) => { if (e.key === 'Enter' && !multiline) e.preventDefault() }}
      {...rest}
    />
  )
}
