# LJHS Dorm Messenger

A private, invite-only messaging PWA for dorm life — WhatsApp-style chat for
students and faculty, where **nobody gets in without a code from an admin**.
Like the Forms app in this repo, it needs no paid server: a Google Sheet plus
one Apps Script deployment is the entire backend.

## Features

- **Invite-only**: admins generate single-use codes (student / faculty / admin
  roles) and share them as one-tap join links
- **Direct messages** between any two members
- **Group chats** (floors, clubs, activities…)
- **Announcement channels**: everyone is in them, only faculty/admins can
  post; students can still react and vote
- **Quick emoji reactions**: 👍 ❤️ 😂 😮 🙏 ✅ — tap 🙂+ (or double-tap a
  bubble for a quick 👍); tap a chip again to remove yours
- **Polls**: up to 8 options, live results, one vote per person (re-vote to
  switch)
- **Check-in / roll call** (dorm special): faculty sends a one-tap
  "I'm here ✔" request and watches the attendance list fill in live
- **Quiet hours**: admin sets a window (e.g. `21:30-07:00`); the app shows a
  🌙 banner during it
- **Moderation**: authors, faculty and admins can delete messages; admins can
  disable accounts instantly
- **PWA**: installable on phones, opens offline, queues messages written
  offline and sends them when back online

## Run it

```bash
cd messenger
npm install
npm run dev        # local development
npm run build      # production build in messenger/dist/
```

## Set up the backend (once, ~3 minutes)

1. Create a new Google Sheet ([sheets.new](https://sheets.new)).
2. **Extensions → Apps Script**, delete the sample code, and paste in
   [`apps-script/Messenger.gs`](apps-script/Messenger.gs).
3. In the editor toolbar select the function **`setup`** and press **Run**
   (authorize when asked). This creates the data tabs and writes your one-time
   **admin invite code** into the *Codes* tab.
4. **Deploy → New deployment → Web app** with:
   - *Execute as*: **Me**
   - *Who has access*: **Anyone**
5. Copy the **Web app URL** (ends in `/exec`).
6. Open the messenger, paste the URL as the server link, enter the admin code
   and your name — you're the admin.
7. In **⚙️ Admin panel**, generate student/faculty codes and tap **Copy join
   link** — each link carries the server URL + code, so people just tap, type
   their name, and they're in.

## How it works

- The Google Sheet is the database: tabs for Users, Codes, Channels, Messages,
  Reactions, Votes and Settings. You can watch messages land in real time.
- All rules are enforced server-side in Apps Script: invite codes are
  single-use, students can't post in announcement channels or start check-ins,
  and disabled accounts are cut off immediately.
- The app polls for new messages (~4s in an open chat, ~8s on the chat list,
  paused while the app is hidden) — simple and reliable, no push
  infrastructure to maintain.
- Signing in stores a private token in `localStorage`; there are no passwords.

## Ideas for later

- Web push notifications (needs a push service / Firebase)
- Photos and attachments (Sheets isn't great at blobs — would use Drive)
- Read receipts, typing indicators, message replies/threads
- Events board with RSVP (a poll variant), lost & found channel preset
- Auto-lock student posting during quiet hours (server-side)
