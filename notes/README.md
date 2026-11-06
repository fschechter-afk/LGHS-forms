# LGHS Notes

A simple, private notes and checklist app for LGHS students. It's a
replacement for Apple Notes that holds **text and checklists only**: no
photos, files, PDFs, drawings, scans or attachments of any kind. Each
student's notes are backed up to her own school email account, sync
automatically, and come back when she signs in on a new phone.

It's deployed next to LGHS Forms and the Messenger at
`https://fschechter-afk.github.io/LGHS-forms/notes/`. It uses the same
GitHub Pages hosting and the same Supabase project the Messenger already
uses, so the school takes on no new services or bills.

---

## 1. Recommendation

**An installable web app (PWA) added to the iPhone home screen. Sign-in uses
the student's school Google (or Microsoft) account, and notes are stored in
the school's existing Supabase database.**

| | Web app on home screen (**chosen**) | Native iPhone app |
|---|---|---|
| Looks & feels like an app | Yes: own icon, full screen, works offline | Yes |
| Cost | $0 | $99/yr Apple Developer account, plus a Mac and Xcode to build it |
| Getting it onto phones | Open a link, then "Add to Home Screen", or the KPhone/MDM provider pushes a "web clip" | App Store review, or private distribution through Apple School Manager + MDM |
| Updates | Instant: push to GitHub and every phone updates on next open | Rebuild, resubmit, wait for review/MDM push |
| Who can maintain it | Anyone comfortable editing this repo | Needs an iOS developer |
| Risk | **Needs Safari (or web clips) allowed on the KPhone**, see §4 | Works even if Safari is fully blocked |

The web app wins on cost, simplicity and ease of administration. If your
KPhone setup blocks Safari and web clips entirely, the same code can be
wrapped into a real App Store/MDM app later with
[Capacitor](https://capacitorjs.com). That's mostly packaging work; the app
itself wouldn't need rewriting.

### Where to store the notes: options considered

| Option | Verdict |
|---|---|
| **Supabase (already used by the Messenger)** | **Chosen.** Real database with row-level security, supports Google and Microsoft sign-in, free tier is ample, already whitelisted on student phones. |
| Firebase (Google) | Equally good technically, free tier ample. But it's a brand-new service to set up, whitelist and administer. |
| Each student's own Google Drive (hidden app folder) | Elegant: data stays in Google Workspace. But it's Google-only, sync conflicts are hard, and it's slower and more fragile on filtered phones. |
| Emailing notes to the student | Rejected: manual, clutters inboxes, no real sync. |

## 2. Answers to your questions

1. **iPhone app or web app?** A web app installed to the home screen. See
   the table above. It's the cheapest and easiest to run, and it can become
   a native app later without a rewrite.
2. **Can we use school Google/Microsoft accounts?** Yes. Students tap **Sign
   in with school email** and use the normal Google (or Microsoft) sign-in.
   There are no new passwords to manage. Only your school's email domain is
   allowed. This is enforced three times: in Google's own settings (an
   "Internal" app accepts only your Workspace's accounts), in the app, and
   in the database itself.
3. **Cheapest secure storage?** The Supabase project you already run. Each
   note is one database row. **Row-level security** means the database
   itself only ever returns a student's own rows. Even someone holding the
   app's public key, or a modified app, cannot read another student's notes.
   This was tested: a second student sees 0 notes and cannot overwrite the
   first student's.
4. **Automatic sync?** Yes. Each keystroke is saved to the phone (within
   about ¼ second), and the note is uploaded about 1½ seconds after she
   stops typing. Notes from other devices download when the app opens or
   comes back to the foreground. With no internet she keeps working
   normally; changes upload when she's back online. The bottom of the screen
   always says **Backed up**, **Saved · backing up…**, or **Saved on phone ·
   will back up when online**.
5. **Can attachments be prevented entirely?** Yes, by construction rather
   than by hiding buttons:
   - Every writing area is a plain-text box (`<textarea>`), which simply
     cannot hold a photo, file or drawing. There's no file picker anywhere
     in the app.
   - Drag-and-drop and pasting photos/files are blocked. Pasting text still
     works.
   - The page's security policy forbids loading images, frames, video or
     plugins from anywhere.
   - The database accepts only a title and text, with size caps (about 150
     printed pages per note), so it can't become file storage.

   iOS's own text tools still work, and they all produce **text**: dictation,
   "Scan Text" (which types out printed text) and sharing selected text.
6. **Lost phone, new phone, graduation?**
   - *Lost/new phone:* she signs in on the new phone and all her notes
     return. If the lost phone is found later and used, its stale copies
     never overwrite newer notes (last edit wins, per note).
   - *Lost phone and privacy:* signing in to her school Google account
     elsewhere and changing her password (or the IT admin resetting it)
     cuts off the old phone's access.
   - *Graduation:* staff can export her notes as plain text (SQL below) to
     give her before her school account closes. Deleting her user afterwards
     removes all her notes.
7. **Ongoing cost for 100–150 students?** **$0** on Supabase's free tier
   plus free GitHub Pages hosting. 150 students × 200 notes each is about
   60 MB, well under the 500 MB free database (shared with the Messenger).
   The recommended optional upgrade is Supabase Pro at **$25/month**, which
   adds daily automatic backups and never pauses (see §6). Maintenance is
   close to zero: no servers to patch, and updates are a `git push`.

## 3. What the prototype does

- Notes list with search, newest first, and an obvious ✎ new-note button
- Title + free writing that scrolls without limit; the line being typed
  stays visible above the keyboard
- **Checklists mixed with text:** tap the checklist button in the bottom
  toolbar to turn the current line (or selected lines) into checklist items,
  or tap it again to turn one back into text. Enter makes the next item;
  Enter on an empty item, or Backspace at the start of an item, goes back to
  plain text. Tap a circle to check or uncheck.
- Rename (edit the title), delete (trash icon, with confirmation), and
  blank notes are discarded automatically
- Autosave on every keystroke; notes survive closing the app, losing
  signal, or the phone dying
- Works fully offline once installed
- Light and dark mode, iPhone safe-area aware
- Sign-out removes her notes from that phone. It warns first if anything
  hasn't been backed up yet.

**Test mode:** while `ALLOW_TEST_MODE` is `true` in `src/config.js`, the
sign-in screen offers *"Try it without signing in"*. Notes are then kept on
that phone only, which lets you try everything before Google sign-in is set
up. **Turn this off before giving it to students.**

## 4. Deploying it for students

Allow about an hour, once. Steps 1–3 are for whoever administers the
school's Google Workspace and the Supabase project.

### Step 1: Create the Google sign-in client (Google Workspace schools)

1. Go to [console.cloud.google.com](https://console.cloud.google.com) **signed
   in with a school admin account** and create a project, e.g. "LGHS Notes".
2. **APIs & Services → OAuth consent screen**: choose **Internal**. This
   alone means only accounts in your school's Workspace can sign in, and
   Google requires no review. App name "LGHS Notes"; scopes: email, profile,
   openid.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID →
   Web application.** Under *Authorized redirect URIs* add
   `https://aheiyytqvzxkoowykkgt.supabase.co/auth/v1/callback`.
4. Copy the **Client ID** and **Client secret**.

*Microsoft 365 school instead?* In the Azure portal, register an app with
**single tenant** ("Accounts in this organizational directory only") and the
same redirect URI. Create a client secret, then set `AUTH_PROVIDER = 'azure'`
in `src/config.js`. Supabase's guide:
<https://supabase.com/docs/guides/auth/social-login/auth-azure>.

### Step 2: Configure Supabase (the Messenger's project)

1. **Authentication → Sign In / Providers → Google**: enable it and paste the
   Client ID and secret. (For Microsoft: **Azure**, plus your tenant URL
   `https://login.microsoftonline.com/<tenant-id>`.)
2. **Authentication → URL Configuration → Redirect URLs**: add
   `https://fschechter-afk.github.io/LGHS-forms/notes/`.
3. **Authentication → Sign In / Providers → Email**: make sure **email
   sign-ups are disabled**. Nothing in this repo uses email+password
   accounts, and leaving it off closes a door. The Messenger keeps working:
   it uses anonymous sign-in.
4. **SQL Editor → New query**: paste [`supabase/notes.sql`](supabase/notes.sql).
   **Change `YOUR-SCHOOL-DOMAIN.org` at the bottom** to your email domain,
   then **Run**. It only adds a notes table and doesn't touch Messenger data.
   It's safe to run again.

### Step 3: Configure and publish the app

1. In [`src/config.js`](src/config.js) set `SCHOOL_EMAIL_DOMAIN` (e.g.
   `'lghs.org'`). Keep `ALLOW_TEST_MODE = true` while staff try it, then set
   it to `false`.
2. Merge this branch into `main`. The existing GitHub Pages workflow builds
   Forms, Messenger **and Notes**, and publishes Notes at
   `https://fschechter-afk.github.io/LGHS-forms/notes/`.

### Step 4: KPhone filter / MDM (talk to your KPhone provider)

- **Whitelist** these hosts:
  - `fschechter-afk.github.io` (the app; already whitelisted for Forms)
  - `aheiyytqvzxkoowykkgt.supabase.co` (the database; already whitelisted
    for the Messenger)
  - Google sign-in: `accounts.google.com`, `ssl.gstatic.com`,
    `www.gstatic.com`, `fonts.gstatic.com`. For Microsoft instead:
    `login.microsoftonline.com`, `aadcdn.msftauth.net`, `login.live.com`.

  Sign-in pages occasionally load from extra Google/Microsoft hosts, so
  confirm on one test phone first.
- **Best:** ask them to push a **Web Clip** of the URL above with
  "Full Screen" on. It then appears on every phone as an app icon with
  nothing for students to do. Ask them to confirm web clips still open if
  Safari is restricted on your KPhones. **This is the one thing to check
  before rollout.** If they won't open, the fallback is the native wrapper
  mentioned in §1.
- **Hide/remove Apple Notes** via MDM (app restriction for
  `com.apple.mobilenotes`). Otherwise students still have the original
  Notes, and the attachment problem remains.

### Step 5: What students do (once)

1. Tap the **Notes** icon (or open the link in Safari, then **Share → Add to
   Home Screen**).
2. Tap **Sign in with school email**, choose her school account, and done.
   She stays signed in from then on.

## 5. Admin tasks (Supabase → SQL Editor)

**Export a student's notes as plain text** (e.g. before graduation):

```sql
select n.title,
       to_timestamp(n.updated_at / 1000) as last_edited,
       string_agg(
         case when b->>'type' = 'check'
              then case when (b->>'done')::boolean then '[x] ' else '[ ] ' end
              else '' end || (b->>'text'),
         E'\n' order by e.ord) as note
from notes n
join auth.users u on u.id = n.user_id,
     jsonb_array_elements(n.body::jsonb) with ordinality as e(b, ord)
where u.email = 'student@your-school.org' and not n.deleted
group by n.id, n.title, n.updated_at
order by n.updated_at desc;
```

**Restore a note a student deleted by accident.** Deleted notes are kept
(marked deleted) so this is possible:

```sql
select n.id, n.title, to_timestamp(n.updated_at / 1000)
from notes n join auth.users u on u.id = n.user_id
where u.email = 'student@your-school.org' and n.deleted;

update notes set deleted = false,
       updated_at = (extract(epoch from now()) * 1000)::bigint
where id = '<id from above>';
```

**Remove a graduate completely:** Authentication → Users → find her email →
Delete user. All her notes are deleted with her account.

**Privacy note:** students' notes are private from each other, but anyone
with access to the Supabase dashboard can technically read them. That's the
same situation as Google Workspace admins and school email. Keep dashboard
access to one or two trusted staff, and tell families the policy.

## 6. Costs, backups and limits

- **Hosting:** GitHub Pages, free.
- **Database:** Supabase free tier, $0. Two caveats:
  - A free project pauses after about a week with *no* activity (e.g. a long
    summer break). The Messenger and Notes keep it busy during the year.
    Waking it is one click in the dashboard.
  - The free tier has **no automatic database backups**. Every student's
    phone holds a full copy of her notes, so a server problem wouldn't erase
    anything. But for proper backups, **Supabase Pro ($25/month)** adds daily
    backups and never pauses. Recommended once students rely on it.
- **Google/Microsoft sign-in:** free.
- **Limits:** about 150 printed pages per note; no limit on number of notes.
  The phone keeps a full local copy (iOS allows each home-screen app several
  MB, which is thousands of typical notes).

## 7. Developing

```bash
cd notes
npm install
npm run dev      # http://localhost:5173 (test mode works without any setup)
npm run build    # production build in notes/dist/
```

| File | What it is |
|---|---|
| `src/main.js` | Screens and the note/checklist editor |
| `src/store.js` | On-phone storage (instant autosave) |
| `src/sync.js` | Sign-in and automatic backup/sync |
| `src/config.js` | School settings |
| `supabase/notes.sql` | Database table, privacy rules, save function |
| `public/sw.js` | Offline support |
