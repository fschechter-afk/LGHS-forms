# LGHS Forms

> **Also in this repo:** [LJHS Dorm Messenger](messenger/README.md) — a
> private, invite-only messaging PWA (DMs, groups, announcements, reactions,
> polls, check-ins). Deployed alongside the forms app at `/messenger/`.

A Google Forms substitute built as an installable PWA. Build forms, share a link,
and every submission is automatically appended to your Google Sheet — no server
needed.

## Features

- **Question types**: short answer, paragraph, multiple choice, checkboxes,
  dropdown, linear scale, date, and time
- **Builder**: required toggle, reorder, duplicate, delete, autosave,
  open/close responses
- **Share by link**: the form travels inside the URL, so anyone with the link
  can fill it out — no account, no backend
- **Google Sheets auto-sync**: each form gets its own tab; headers are created
  automatically and new questions become new columns
- **PWA**: installable on phones/desktops, works offline, and queues
  submissions made offline to sync when back online
- **Responses page**: local response table + CSV export + jump to the Sheet

## Run it

```bash
npm install
npm run dev        # local development
npm run build      # production build in dist/
```

Deploy the `dist/` folder to any static host (GitHub Pages, Netlify, Vercel, …).
The PWA service worker and share links work best on a real HTTPS URL.

## Connect Google Sheets (one-time, ~2 minutes)

1. Create or open a Google Sheet ([sheets.new](https://sheets.new)).
2. In the Sheet: **Extensions → Apps Script**. Delete the sample code and paste
   in [`apps-script/Code.gs`](apps-script/Code.gs).
3. **Deploy → New deployment → Web app**, with:
   - *Execute as*: **Me**
   - *Who has access*: **Anyone**
4. Copy the **Web app URL** (ends in `/exec`).
5. In the app, open **⚙ Sheets setup**, paste the URL, and hit **Send a test
   row** — a "Connection test" tab should appear in your Sheet.

From then on, every share link you copy embeds the connection, so responses
from anyone's device land in your Sheet automatically.

> If you later change the Apps Script deployment URL, re-copy your share links
> so they point at the new deployment.

## How it works

- Forms and settings are stored in `localStorage` on the owner's device.
- Share links encode the whole form definition (plus the Sheets webhook URL)
  in the URL fragment, so filling out a form needs no backend at all.
- Submissions POST JSON to the Apps Script web app, which appends a row to the
  matching sheet tab (`src/sheets.js` + `apps-script/Code.gs`).
- If the responder is offline, the submission is queued locally and retried
  automatically when the app comes back online.
