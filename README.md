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

## Check it

```
scripts/check.sh
```

Runs install, typecheck, unit/API tests and the browser tests, and stops at the first failure.
