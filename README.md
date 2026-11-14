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

On My items, Add an item opens a full-screen camera. Take a photo, pick one from the gallery, or tap Type it in to skip the photo. After a photo, the form opens with a suggested name and category already filled in. Both are always editable, and if the suggestion is unsure or fails the photo is kept and the name is left for you to type.

Suggestions run on the device with CLIP (`Xenova/clip-vit-base-patch32`, MIT) through a pinned build of Transformers.js. There is no cloud vision API, no extra key, and the photo is not sent anywhere for this. The first time someone uses a photo, the browser downloads the library from jsDelivr and the model files from Hugging Face, then keeps them in its cache. That download is not small (the combined quantized model is about 147 MB, plus a 4 MB WASM file), so it can take a while on a slow connection. No model files are committed here and the service worker does not precache them.

The suggestion never blocks the form. After a photo the screen says "Looking at the photo..." (with download progress while the model downloads), and after about 15 seconds the form opens anyway with the photo attached and the name and category empty, with a quiet note. Type it in stays tappable the whole time and opens the form with the photo if one was chosen. If the model finishes later, it fills the name and category only if the person has not typed or chosen anything. A load or inference failure falls back the same way. ONNX Runtime runs in a worker (`wasm.proxy = true`) so the timer and Type it in stay responsive.

The Content-Security-Policy for this: `script-src` allows jsDelivr (the library); `connect-src` allows `huggingface.co`, `*.huggingface.co`, `*.hf.co`, `*.cdn.hf.co` and `*.xethub.hf.co`. Hugging Face answers a weight download with a 302 to a multi-label CDN host such as `us.aws.cdn.hf.co`, so that host family is listed explicitly instead of relying on one `*.hf.co` wildcard match, which some browsers do not apply to nested labels. `worker-src 'self' blob:` is there because the ONNX Runtime worker is started from a blob URL (`'self'` keeps the service worker, `/sw.js`, allowed, since `worker-src` governs it too). Nothing else was widened (`script-src` has no `blob:`).

Tests: the UI specs in `test/ui/camera-add.spec.ts` use a stub suggester for speed, including a never-answering one for the timeout. `test/ui/camera-real.spec.ts` does not stub. It uploads `test/fixtures/cordless-drill.jpg` (CC0, see its SOURCE file) through the real CSP and model path, and passes either with a suggestion or with the fallback form, so it still passes offline. The model files it downloads are kept in `test/.model-cache/` (gitignored), so only the first run pays for the 147 MB.

Categories are a fixed list (Tools, Kitchen, Camping, Sports, Garden, Electronics, Kids, Household, Other), kept in both `src/categories.ts` and `public/categories.js`.

## Check it

```
scripts/check.sh
```

Runs install, typecheck, unit/API tests and the browser tests, and stops at the first failure.
