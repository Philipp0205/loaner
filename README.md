# Loan some

Loan some (formerly called Loaner) is a small app for lending things to friends. You have a drill you use twice a year, a friend needs one on Saturday. Loan some connects you and keeps track of who has what.

- Invite-only groups of people who know each other (family, flatmates, climbing club). You can be in several.
- List an item with a photo, say which of your groups can see it, and optionally suggest a donation for valuable things. Money never moves in the app.
- Friends request it for dates, you approve, hand it over, and mark it returned. Everyone gets reminders before it is due.
- No passwords: your phone gets a device token, plus a recovery code in case you switch phones. Sign-up asks for an email, confirmed with a link, and a confirmed email can mail a one-time sign-in link if the recovery code is lost.

Status: early v1 in progress.

The product spec is in [docs/brief.md](docs/brief.md).

## Run it

Needs Node 22.5 or newer.

```
npm install && npm start
```

Then open http://localhost:3000 on your phone or in a browser.

Optional environment: `PORT` (3000), `DB_PATH` (`data/loaner.db`), `APP_TZ` (`UTC`, used for due dates and reminders). Web push is off unless `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` are set; `npm run vapid` prints a fresh pair. Never commit them.

Email: set `RESEND_API_KEY` to send the confirm and sign-in links through Resend. `MAIL_FROM` is the From header (default `Loan some <hello@loanso.me>`) and `APP_ORIGIN` is the public address used inside the links (default `https://www.loanso.me` in production, `http://localhost:<port>` otherwise). Without the key the app still runs and sign-up works, but no mail is sent, so nobody can confirm an address or get a sign-in link. The server prints `email on` or `email off` at start, and warns in production when the key is missing. Never commit the key.

## Deploy on Railway

The start command is `node --import tsx --import ./src/quiet-warnings.ts src/server.ts` (also what `npm start` runs). It is set in `railway.json` so Railway runs node directly and not through npm. With npm in the middle, a SIGTERM on redeploy made npm report a failed command and Railway showed a crash. Now the server handles SIGTERM and SIGINT itself: it stops accepting connections, stops the reminder timer, closes the database, logs one line and exits 0 (with a forced exit after 8 seconds if a connection hangs). `restartPolicyType` stays `ON_FAILURE`, so a clean exit is not restarted. `tsx` is a regular dependency because the start command needs it at runtime.

Railway stops reading `railway.json` and `railway.toml` on 1 Dec 2026. Before then, set the service start command in the Railway dashboard to the same value, `node --import tsx --import ./src/quiet-warnings.ts src/server.ts`.

The `node:sqlite` ExperimentalWarning is filtered out by `src/quiet-warnings.ts`, which the start command preloads with `--import`. It has to be a preload because ESM links `node:sqlite` while the module graph is instantiated, before any app module runs, so an import inside `src/server.ts` would install the filter too late. Only that one warning is dropped; other warnings are still printed.

## Feedback

The You tab has a Send feedback row. It opens a sheet where a signed-in person writes a message (1 to 2000 characters) and can attach one photo or screenshot. The server stores it with their name, the app version, and their user agent. Each person can send 10 per hour.

To read it, set `FEEDBACK_ADMIN_TOKEN` to a long random string of at least 32 characters. Never commit it. Send it as a bearer token:

- `GET /api/admin/feedback?since=<iso>` lists feedback newest first (up to 200 rows). `since` is an ISO date or time and keeps only rows created after it. Rows have `id`, `userId`, `displayName`, `text`, `appVersion`, `userAgent`, `createdAt`, `status` and `hasPhoto`.
- `PATCH /api/admin/feedback/:id` with `{ "status": "new" | "seen" | "done" }` sets the status.
- `GET /api/admin/feedback/:id/photo` returns the attached photo, if there is one.

Both admin routes answer 404 when `FEEDBACK_ADMIN_TOKEN` is unset. When it is set, a missing or wrong token also gets 404, so the endpoint does not show that it exists. A signed-in person's device token is not an admin token. There is no admin screen in the app.

## Add an item with the camera

On My items, Add an item opens a full-screen camera. Take a photo, pick one or more from the gallery, or tap Type it in to skip the photos. The form then opens and you type the name and pick a category. Nothing is guessed from the photo, and no photo leaves the device except to be saved on the item.

An item holds up to 6 photos (`item_photos`, shown in order). The item page shows one photo as before, or a swipeable gallery with a counter for several, and a tap opens a full-screen viewer. Photos are served by `GET /api/items/:id/photos/:pid` and added with `POST /api/items/:id/photos` (raw bytes, JPEG, PNG or WebP, 2 MB at most each, a 409 past 6). The older single photo routes (`PUT`, `GET`, `DELETE /api/items/:id/photo`) still work on the first photo. On start, an old single photo is copied into `item_photos` once and the old columns are cleared.

A suggested donation is either an amount in euros (`donation`) or up to 60 characters of words such as "a beer" (`donationText`), never both. It is display only.

The Content-Security-Policy is `self` only for scripts, fetches, images and media, with no CDN and no worker or wasm sources.

Tests: `test/ui/camera-real.spec.ts` uploads `test/fixtures/cordless-drill.jpg` (CC0, see its SOURCE file) from the gallery through the real CSP. `test/ui/photos.spec.ts` covers the picker, the gallery and the viewer.

Categories are a fixed list (Tools, Kitchen, Camping, Sports, Garden, Electronics, Kids, Household, Other), kept in both `src/categories.ts` and `public/categories.js`.

## Check it

```
scripts/check.sh
```

Runs install, typecheck, unit/API tests and the browser tests, and stops at the first failure.
