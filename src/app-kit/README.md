# server/

TypeScript modules for the two TypeScript apps (Hangry and Loan some). Only `node:` built-ins, no runtime dependencies, no build step. Plain `.ts` that runs on Node type stripping (Node >= 22.18, or 24): erasable syntax only, `import type` for types, relative imports with the `.ts` extension.

The kit has no router and no app wrapper. The apps keep their own route tables and call these functions from them.

Import from `index.ts`, or from a single module:

    import { clientKey, createRateLimiter, readJson, sendJson } from "./app-kit/index.ts";

| Module | Exports |
| --- | --- |
| `rate-limit.ts` | `createRateLimiter({ limit, windowMs, maxKeys? })` returns `{ hit(key, now), resetIn(key, now), size() }`. Fixed window per key, expired windows pruned, at most `maxKeys` (default 10000) keys. The clock is the `now` argument. Type `RateLimiter`. |
| `client-key.ts` | `clientKey(req)`: the rightmost `X-Forwarded-For` hop, else the socket address, else `"unknown"`. Takes any `{ headers, socket }`. Type `ClientKeyRequest`. |
| `time.ts` | `isoDate`, `addDays`, `isCalendarDate`, `daysBetween`, `isTimeZone`, `assertTimeZone`, `zonedParts`, `zonedDateTime` (first instant on fall-back, RFC 5545 gap rule), `endOfDay`. No label formatters (`shortDate`, `dayLabel`, `clockLabel`, `noticeDay`): those stay in the apps. |
| `http.ts` | `HttpError(status, message, code?)`, `SECURITY_HEADERS`, `sendJson(res, status, body, extraHeaders?)`, `sendEmpty(res, status)`, `readBody(req, maxBytes)`, `readJson(req, { max? })` (default 16 KiB; 400 invalid JSON, 413 too large, oversize bodies are drained and never kept), `errorBody(error)`, `sendError(res, error, log?)` (unknown errors become `500 {"error":"internal error"}`). `DEFAULT_JSON_MAX_BYTES`. |
| `csp.ts` | `buildCsp(directives)`: a `Content-Security-Policy` value from per-directive allowlists, strict defaults, throws on `;`, `,`, whitespace or control characters in a value. `CSP_DEFAULTS`. No built-in CDN list. |
| `static.ts` | `serveStatic(root, options)` returns `async (req, res, pathname) => boolean`. GET and HEAD only, `..` and NUL rejected, never leaves `root` (symlinks too), SPA fallback to `index.html`, configurable cache-control. Type `StaticOptions`. |
| `health.ts` | `healthHandler(req, res)`: `GET`/`HEAD /api/health` is `200 {"ok":true}`, other methods are 405, any other path returns `false`. `isHealthRequest(req)`, `HEALTH_PATH`. |
| `shutdown.ts` | `installGracefulShutdown({ server, onClose, forceExitMs = 8000, signals, exit, log, ... })` returns `{ shutdown, dispose }`. Closes the server on SIGTERM and SIGINT, closes idle connections, force-exits on an unref'd timer, runs `onClose` once. Every side effect can be injected for tests. |

See the README in the repo root for a wired-together example and `docs/java-conventions.md` for the Java side.
