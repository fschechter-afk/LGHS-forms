import React, { useEffect, useState } from 'react'
import Home from './components/Home.jsx'
import Builder from './components/Builder.jsx'
import FillForm from './components/FillForm.jsx'
import Responses from './components/Responses.jsx'
import Settings from './components/Settings.jsx'
import { decodeForm, getForm, getSettings } from './storage.js'
import { flushQueue } from './sheets.js'

function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, '')
  const [page, ...rest] = hash.split('/')
  return { page: page || 'home', param: rest.join('/') }
}

export default function App() {
  const [route, setRoute] = useState(parseRoute())

  useEffect(() => {
    const onHash = () => setRoute(parseRoute())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Retry queued submissions when the app opens or comes back online.
  useEffect(() => {
    flushQueue()
    const onOnline = () => flushQueue()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [])

  const { page, param } = route

  if (page === 'fill') {
    const shared = decodeForm(param)
    return <FillForm form={shared} endpoint={shared?.endpoint || ''} shared />
  }

  if (page === 'preview') {
    const form = getForm(param)
    return <FillForm form={form} endpoint={getSettings().sheetsEndpoint} preview />
  }

  if (page === 'edit') return <Builder formId={param} />
  if (page === 'responses') return <Responses formId={param} />
  if (page === 'settings') return <Settings />
  return <Home />
}
