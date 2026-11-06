// One-time configuration for LGHS Notes. See notes/README.md for every step.

// The school's Supabase project. These are the same public values the
// Messenger uses (notes live in their own table, protected by row-level
// security — see supabase/notes.sql). The anon key is public by design.
export const SUPABASE_URL = 'https://aheiyytqvzxkoowykkgt.supabase.co'
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFoZWl5eXRxdnp4a29vd3lra2d0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2MDI2MDksImV4cCI6MjA5ODE3ODYwOX0.7sUnV4JvXYwfkiZZFJBWTilJw3cxvl0e-B9sZW9CroY'

// Which school email system students sign in with:
//   'google' — Google Workspace (Gmail) school accounts
//   'azure'  — Microsoft 365 (Outlook) school accounts
export const AUTH_PROVIDER = 'google'

// The part after the @ in student email addresses, e.g. 'lghs.org'.
// Anyone signing in with another address is turned away. The database
// enforces the same rule on its own (supabase/notes.sql), so this is a
// friendly early check, not the only one.
export const SCHOOL_EMAIL_DOMAIN = ''

// Prototype only: shows "Try it without signing in" on the sign-in screen,
// which keeps notes on that one phone with no backup. Set to false before
// handing the app to students.
export const ALLOW_TEST_MODE = true

export const APP_NAME = 'LGHS Notes'
