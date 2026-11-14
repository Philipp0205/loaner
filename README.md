# Loaner

Loaner is a small app for lending things to friends. You have a drill you use twice a year, a friend needs one on Saturday. Loaner connects you and keeps track of who has what.

- Invite-only groups of people who know each other (family, flatmates, climbing club). You can be in several.
- List an item with a photo, say which of your groups can see it, and optionally suggest a donation for valuable things. Money never moves in the app.
- Friends request it for dates, you approve, hand it over, and mark it returned. Everyone gets reminders before it is due.
- No passwords: your phone gets a device token, plus a recovery code in case you switch phones.

Status: early v1 in progress.

The product spec is in [docs/brief.md](docs/brief.md).

## Run it

Needs Node 22.5 or newer.

```
npm install && npm start
```

Then open http://localhost:3000 on your phone or in a browser.

Optional environment: `PORT` (3000), `DB_PATH` (`data/loaner.db`), `APP_TZ` (`UTC`, used for due dates and reminders). Web push is off unless `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` are set; `npm run vapid` prints a fresh pair. Never commit them.

## Feedback

The You tab has a Send feedback row. It opens a sheet where a signed-in person writes a message (1 to 2000 characters) and can attach one photo or screenshot. The server stores it with their name, the app version, and their user agent. Each person can send 10 per hour.

To read it, set `FEEDBACK_ADMIN_TOKEN` to a long random string of at least 32 characters. Never commit it. Send it as a bearer token:

- `GET /api/admin/feedback?since=<iso>` lists feedback newest first (up to 200 rows). `since` is an ISO date or time and keeps only rows created after it. Rows have `id`, `userId`, `displayName`, `text`, `appVersion`, `userAgent`, `createdAt`, `status` and `hasPhoto`.
- `PATCH /api/admin/feedback/:id` with `{ "status": "new" | "seen" | "done" }` sets the status.
- `GET /api/admin/feedback/:id/photo` returns the attached photo, if there is one.

Both admin routes answer 404 when `FEEDBACK_ADMIN_TOKEN` is unset. When it is set, a missing or wrong token also gets 404, so the endpoint does not show that it exists. A signed-in person's device token is not an admin token. There is no admin screen in the app.

## Check it

```
scripts/check.sh
```

Runs install, typecheck, unit/API tests and the browser tests, and stops at the first failure.
