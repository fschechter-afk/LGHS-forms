import React, { useEffect, useState } from 'react'
import Join from './components/Join.jsx'
import ChatList from './components/ChatList.jsx'
import ChatView from './components/ChatView.jsx'
import NewChat from './components/NewChat.jsx'
import Admin from './components/Admin.jsx'
import { getSession, clearSession } from './storage.js'
import { flushOutbox, supabase } from './api.js'
import { inQuietHours } from './quietHours.js'

function parseHash() {
  const h = window.location.hash.slice(1)
  if (h.startsWith('chat/')) return { view: 'chat', channelId: h.slice(5) }
  if (h === 'new') return { view: 'new' }
  if (h === 'admin') return { view: 'admin' }
  if (h.startsWith('join=')) return { view: 'joinLink', payload: h.slice(5) }

  // Invite links also travel as query parameters. Fragments get stripped by
  // some in-app browsers and by redirects, which silently drops the code and
  // leaves people staring at an empty form; a query string survives both.
  const q = new URLSearchParams(window.location.search)
  if (q.get('join')) return { view: 'joinLink', payload: q.get('join') }
  if (q.get('code')) return { view: 'joinLink', code: q.get('code') }

  return { view: 'chats' }
}

export default function App() {
  const [session, setSession] = useState(getSession)
  const [route, setRoute] = useState(parseHash)

  useEffect(() => {
    const onHash = () => setRoute(parseHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Retry queued offline messages whenever we come back online.
  useEffect(() => {
    if (!session) return
    flushOutbox().catch(() => {})
    const onOnline = () => flushOutbox().catch(() => {})
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [session])

  // An existing member who taps an invite link again (they saved it, or it
  // got re-shared) should land in their chats, not back on the join form.
  useEffect(() => {
    if (session && route.view === 'joinLink') {
      // Strip both carriers so a re-tapped invite link doesn't keep
      // bouncing an existing member back to the join form.
      window.history.replaceState(null, '', window.location.pathname)
      setRoute({ view: 'chats' })
    }
  }, [session, route.view])

  const signOut = () => {
    // Accounts are anonymous (no password), so signing out abandons this
    // device's account for good — a new invite code is needed to rejoin.
    //
    // Clear locally FIRST. Awaiting the server call left the button dead
    // whenever that request hung (offline, paused project, flaky wifi):
    // a hang neither resolves nor rejects, so nothing after it ever ran.
    let client = null
    try {
      client = supabase()
    } catch {
      // No client yet — local state is still ours to clear.
    }
    clearSession()
    setSession(null)
    window.location.hash = ''
    // Best effort, in the background; the user is already signed out.
    client?.auth.signOut().catch(() => {})
  }

  if (!session) {
    return (
      <Join
        joinPayload={route.view === 'joinLink' ? route.payload : null}
        joinCode={route.view === 'joinLink' ? route.code : null}
        onJoined={(s) => {
          setSession(s)
          window.location.hash = ''
        }}
      />
    )
  }

  const quiet = inQuietHours(session.settings?.quietHours)

  return (
    <div className="app">
      {quiet && (
        <div className="quiet-banner">
          🌙 Quiet hours ({session.settings.quietHours}) — notifications are muted. Be considerate!
        </div>
      )}
      {route.view === 'chat' ? (
        <ChatView
          key={route.channelId}
          channelId={route.channelId}
          session={session}
          quiet={quiet}
          onBack={() => (window.location.hash = '')}
        />
      ) : route.view === 'new' ? (
        <NewChat session={session} onBack={() => (window.location.hash = '')} />
      ) : route.view === 'admin' ? (
        <Admin session={session} onSettingsChanged={setSession} onBack={() => (window.location.hash = '')} />
      ) : (
        <ChatList session={session} onSignOut={signOut} />
      )}
    </div>
  )
}
