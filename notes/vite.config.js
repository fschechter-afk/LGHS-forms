import { defineConfig } from 'vite'

// Content-Security-Policy for the production build. It is the browser-level
// guarantee behind "text only": the page may load code only from itself, may
// talk only to Supabase, cannot embed frames or plugins, and cannot show any
// image except its own icons. (Injected at build time only, so the Vite dev
// server's live-reload keeps working.)
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "frame-src 'none'",
  "object-src 'none'",
  "media-src 'none'",
  "form-action 'none'",
  "base-uri 'self'",
].join('; ')

export default defineConfig({
  base: './',
  plugins: [
    {
      name: 'notes-csp',
      apply: 'build',
      transformIndexHtml: (html) =>
        html.replace('<meta charset="UTF-8"/>', `<meta charset="UTF-8"/>\n  <meta http-equiv="Content-Security-Policy" content="${CSP}"/>`),
    },
  ],
})
