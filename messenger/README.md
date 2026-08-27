# LGHS School Messenger

A private, invite-only messaging PWA for dorm life — WhatsApp-style chat for
students, parents and staff, where **nobody gets in without a code from an admin**.
The backend is a free [Supabase](https://supabase.com) project: a real
Postgres database with instant message delivery over websockets, at $0 on the
free tier (no credit card required — if you ever hit limits it throttles, it
never charges).

## Features

- **Invite-only**: admins generate invite codes per role (student / parent / staff / admin) — a **shared** code the whole group reuses, or single-use codes
  — and share them as one-tap join links; codes can be revoked anytime
- **Instant delivery**: messages, reactions and votes arrive in real time over
  Supabase Realtime (with polling as an automatic fallback)
- **Direct messages** between any two members
- **Group chats** (floors, clubs, activities…)
- **Announcement channels**: everyone is in them, only staff/admins can
  post; students can still react and vote
- **Quick emoji reactions**: 👍 ❤️ 😂 😮 🙏 ✅ — tap 🙂+ (or double-tap a
  bubble for a quick 👍); tap a chip again to remove yours
- **Polls**: up to 8 options, live results, one vote per person (re-vote to
  switch)
- **Check-in / roll call** (dorm special): staff send a one-tap
  "I'm here ✔" request and watches the attendance list fill in live
- **Quiet hours**: admin sets a window (e.g. `21:30-07:00`); the app shows a
  🌙 banner during it
- **Push notifications for Announcements**: members can opt in to a phone
  notification whenever staff/admins post to 📣 Announcements — even with the
  app closed. DMs and groups stay in-app only, on purpose
- **Moderation**: authors, staff and admins can delete messages; admins can
  disable accounts instantly, or remove a user entirely (account + their messages)
- **PWA**: installable on phones, opens offline, queues messages written
  offline and sends them when back online

## Run it

```bash
cd messenger
npm install
npm run dev        # local development
npm run build      # production build in messenger/dist/
```

## Set up the backend (once, ~5 minutes, free)

1. Create a free project at [supabase.com](https://supabase.com)
   (no credit card needed).
2. In the dashboard: **Authentication → Sign In / Up → enable "Anonymous
   sign-ins"**. Devices sign in anonymously; identity comes from invite
   codes, not passwords.
3. **SQL Editor → New query**, paste in the whole of
   [`supabase/schema.sql`](supabase/schema.sql), and **Run**. The query
   result shows your one-time **admin invite code**.
4. **Project Settings → API**: copy the **Project URL** and the
   **anon public** key.
5. **Recommended**: paste those two values into
   [`src/config.js`](src/config.js) and commit — once the app is rebuilt and
   deployed, nobody ever sees a URL or key again: the join screen only asks
   for an invite code and a name. (Without this step the app still works;
   the join screen just shows two extra fields, which join links fill in
   automatically.)
6. Open the messenger, enter the admin code and your name — you're the admin.
7. In **⚙️ Admin panel**, generate codes and tap **Copy join
   link** — people just tap the link, type their name, and they're in.

## Push notifications for Announcements (optional, ~5 minutes)

Members can get a phone notification whenever staff/admins post to 📣
Announcements, even with the app closed — DMs and groups never do this, so a
busy group thread can't buzz someone's lock screen. `schema.sql` above
already creates the database side; this adds the two pieces schema.sql can't
set up for you (a deployed function has to exist before the database can
call it, and its secret keys must never be pasted into a file that gets
committed to a repo).

1. **Generate a VAPID key pair** (identifies your server to push
   services — a one-time, free, no-account step):
   ```bash
   npx web-push generate-vapid-keys
   ```
2. **Deploy the Edge Function**: install the
   [Supabase CLI](https://supabase.com/docs/guides/cli), then from the
   `messenger/` folder:
   ```bash
   supabase functions deploy send-announcement-push --project-ref YOUR-PROJECT-REF --no-verify-jwt
   ```
3. **Set its secrets** — dashboard **Project Settings → Edge Functions →
   Secrets** (or `supabase secrets set`): `VAPID_PUBLIC_KEY`,
   `VAPID_PRIVATE_KEY` (both from step 1), and `VAPID_SUBJECT` (a
   `mailto:your-email@example.com` the push services can contact you at if
   something's wrong).
4. Back in `schema.sql`'s push-notifications section (already run in step
   3 of the main setup above), replace `YOUR-PROJECT-REF` in the
   `notify_announcement_push` function with your real project ref
   (**Project Settings → General → Reference ID**) and re-run just that
   `create or replace function` statement in the SQL Editor.
5. Paste the **public** key from step 1 into `VAPID_PUBLIC_KEY` in
   [`src/config.js`](src/config.js) and redeploy the app. (Only the public
   key goes here — it's meant to be visible to every device. The private key
   stays in the Edge Function secret from step 3, never in this repo.)

Members turn it on themselves from a banner on their chat list — nobody gets
notifications until they tap it and allow the browser permission prompt.

## Security model

- The anon key in join links is Supabase's *public* client key — it grants
  nothing by itself. Every read goes through Postgres **row-level security**
  (you only see channels you're a member of) and every write goes through
  server-side SQL functions that enforce the rules: invite codes are
  single-use, students can't post announcements or start check-ins, and
  disabled accounts are cut off instantly.
- Accounts are anonymous per device (no passwords). Signing out abandons the
  device's account — rejoining takes a fresh invite code. Reopening or
  reinstalling the app on the same browser keeps the account.
- Admins can inspect or edit all data in the Supabase dashboard
  (**Table Editor**).

## Free-tier notes

- Free tier includes 500 MB database, 50k monthly active users, 200
  concurrent realtime connections, 2M realtime messages/month — far more
  than a dorm needs.
- Projects **pause after ~1 week with no traffic**; wake them with one click
  in the dashboard. Daily dorm use keeps it awake on its own.

## Ideas for later

- Photo attachments (Supabase Storage, 1 GB free)
- Read receipts, typing indicators, message replies/threads
- Events board with RSVP (a poll variant), lost & found channel preset
- Auto-lock student posting during quiet hours (enforced in SQL)
