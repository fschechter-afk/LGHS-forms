# LGHS Forms

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
- **Student hub**: one permanent link that lists every form you've published —
  ideal for filtered phones (whitelist once, add forms forever)
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

> **Updating the script later**: paste the new code, then use
> **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**.
> That keeps the same `/exec` URL. Creating a brand-new deployment gives a new
> URL and breaks existing share/hub links.

## Student hub (one permanent link)

The hub is a single page that always lists your currently published forms —
students bookmark (or a filtered-phone provider whitelists) one URL, once.

1. In **⚙ Sheets setup**, tap **Copy hub link** and hand that link out.
2. On any form, tap **Publish to hub** — it appears on the hub immediately.
   After editing a published form, tap **Update hub**; use **Unpublish** to
   take it down.
3. Published forms are stored in a hidden `_Published Forms` tab of your
   spreadsheet, so no extra services are involved.

Optional hardening: set `PUBLISH_KEY` in `Code.gs` to a password and enter the
same key in ⚙ Sheets setup, so only you can publish to the hub.

### Filtered phones / whitelisting

Everything students need runs under exactly these hosts — whitelisting them
once covers the hub and every current and future form:

- `<your-username>.github.io` (the app itself, e.g. `fschechter-afk.github.io`)
- `script.google.com` and `script.googleusercontent.com` (submitting responses
  and loading the hub's form list)

## How it works

- Forms and settings are stored in `localStorage` on the owner's device.
- Share links encode the whole form definition (plus the Sheets webhook URL)
  in the URL fragment, so filling out a form needs no backend at all.
- Submissions POST JSON to the Apps Script web app, which appends a row to the
  matching sheet tab (`src/sheets.js` + `apps-script/Code.gs`).
- If the responder is offline, the submission is queued locally and retried
  automatically when the app comes back online.
