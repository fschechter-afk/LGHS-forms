// One-time app configuration.
//
// After creating your Supabase project (see README.md), paste its values
// here and rebuild/redeploy. With these filled in, the join screen only asks
// for an invite code and a name, and join links get much shorter.
//
//   Supabase dashboard → Project Settings → API
//     - Project URL      → SUPABASE_URL   (looks like https://abcdefgh.supabase.co)
//     - anon public key  → SUPABASE_ANON_KEY
//
// The anon key is Supabase's *public* client key — safe to commit. All real
// permissions are enforced server-side by the SQL in supabase/schema.sql.

export const SUPABASE_URL = 'https://aheiyytqvzxkoowykkgt.supabase.co'
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFoZWl5eXRxdnp4a29vd3lra2d0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2MDI2MDksImV4cCI6MjA5ODE3ODYwOX0.7sUnV4JvXYwfkiZZFJBWTilJw3cxvl0e-B9sZW9CroY'

// Public half of the VAPID key pair used for push notifications (see
// supabase/upgrade-push-notifications.sql). Safe to expose — it's the whole
// point of "public" key. The matching private key lives only as a Supabase
// Edge Function secret, never in this repo.
export const VAPID_PUBLIC_KEY =
  'BPa8uEneFJl0e1aDT-YqwyXa8owTy1UcMXHaqJ9sL2_2o8CYGasmaE3DcJ3g09NDzfij3-PBeqQ152YavK4Zjsc'
