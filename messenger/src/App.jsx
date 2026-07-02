import React, { useEffect, useState } from 'react'
import Join from './components/Join.jsx'
import ChatList from './components/ChatList.jsx'
import ChatView from './components/ChatView.jsx'
import NewChat from './components/NewChat.jsx'
import Admin from './components/Admin.jsx'
import { getSession, clearSession } from './storage.js'
import { flushOutbox } from './api.js'
import { inQuietHours } from './quietHours.js'

function parseHash() {
  const h = window.location.hash.slice(1)
  if (h.startsWith('chat/')) return { view: 'chat', channelId: h.slice(5) }
  if (h === 'new') return { view: 'new' }
  if (h === 'admin') return { view: 'admin' }
  if (h.startsWith('join=')) return { view: 'joinLink', payload: h.slice(5) }
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

  const signOut = () => {
    clearSession()
    setSession(null)
    window.location.hash = ''
  }

  if (!session || route.view === 'joinLink') {
    return (
      <Join
        joinPayload={route.view === 'joinLink' ? route.payload : null}
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
