import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SECURITY_HEADERS,
  buildCsp,
  createAuth,
  createRateLimiter,
  healthHandler,
  isHealthRequest,
  needsEmail,
  readBody,
  sendJson,
  serveStatic,
  type Mailer,
} from "./app-kit/index.ts";
import { sqliteAuthStore } from "./auth-store.js";
import type { Config } from "./config.js";
import { get } from "./db.js";
import { createMailer } from "./mail.js";
import type { DatabaseSync } from "node:sqlite";
import type { PushSender } from "./push.js";
import { authRoutes } from "./routes-auth.js";
import { feedbackRoutes } from "./routes-feedback.js";
import { groupRoutes } from "./routes-groups.js";
import { itemRoutes } from "./routes-items.js";
import { messageRoutes } from "./routes-messages.js";
import { notificationRoutes } from "./routes-notifications.js";
import { photoRoutes } from "./photos/routes.js";
import { requestRoutes } from "./routes-requests.js";
import { HttpError, Reply, bearerToken, type Ctx, type Route, type User } from "./types.js";

export type AppDeps = {
  db: DatabaseSync;
  config: Config;
  now: () => number;
  push: PushSender;
  /** Defaults to Resend when RESEND_API_KEY is set, otherwise no mail is sent. Tests pass a stub. */
  mailer?: Mailer;
};

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

// Everything is served from this origin. Nothing is loaded from a CDN, and there are no workers or wasm.
export const CONTENT_SECURITY_POLICY = buildCsp({
  "default-src": ["'self'"],
  "img-src": ["'self'", "blob:", "data:"],
  "media-src": ["'self'", "blob:"],
  "style-src": ["'self'"],
  "style-src-attr": ["'unsafe-inline'"],
  "script-src": ["'self'"],
  "connect-src": ["'self'"],
  "object-src": ["'none'"],
  "base-uri": ["'none'"],
  "frame-ancestors": ["'none'"],
});

/** The kit serves the SPA shell for extensionless paths. Static files stay no-cache (the kit default). */
const staticFiles = serveStatic(PUBLIC_DIR);

type Compiled = { route: Route; pattern: RegExp; keys: string[] };

function compile(routes: Route[]): Compiled[] {
  return routes.map((route) => {
    const keys: string[] = [];
    const source = route.path.replace(/:([a-z]+)/g, (_m, key: string) => {
      keys.push(key);
      return "([^/]+)";
    });
    return { route, pattern: new RegExp(`^${source}$`), keys };
  });
}

export function createApp(deps: AppDeps): http.RequestListener {
  const ctx: Ctx = { db: deps.db, config: deps.config, now: deps.now, push: deps.push };
  const auth = createAuth({
    store: sqliteAuthStore(deps.db),
    mailer: deps.mailer ?? createMailer(deps.config),
    limiter: createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 }),
    appName: "Loan some",
    now: deps.now,
    // The token rides in the fragment, so it never reaches a server log or a Referer header.
    linkUrl: (kind, token) => `${deps.config.appOrigin}/${kind}#t=${token}`,
  });
  const routes = compile([
    ...authRoutes(auth),
    ...groupRoutes(),
    ...itemRoutes(),
    ...photoRoutes(),
    ...requestRoutes(),
    ...messageRoutes(),
    ...notificationRoutes(),
    ...feedbackRoutes(),
    {
      method: "GET",
      path: "/api/config",
      open: true,
      handler: () => ({ pushPublicKey: deps.config.vapid?.publicKey ?? null }),
    },
  ]);

  return (req, res) => {
    // writeHead merges what is set here, so every response (JSON, static, health, errors) carries the CSP.
    res.setHeader("content-security-policy", CONTENT_SECURITY_POLICY);
    handle(req, res).catch((error: unknown) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (error instanceof HttpError) sendJson(res, error.status, { error: error.message });
      else {
        console.error("request failed", error instanceof Error ? error.stack : error);
        sendJson(res, 500, { error: "something went wrong" });
      }
    });
  };

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const method = req.method ?? "GET";
    if (isHealthRequest(req)) {
      // A check that throws (a broken database) answers 503 {"ok":false}. Returning false would still be a 200.
      await healthHandler(req, res, () => get(ctx.db, "SELECT 1 AS ok"));
      return;
    }
    if (!url.pathname.startsWith("/api/")) {
      // The public home page is a real document at "/" and at /welcome (which never redirects, see landing.js).
      // The app shell answers /app, /join/<code> and every other extensionless path (the kit's SPA fallback).
      const isHome = url.pathname === "/" || url.pathname === "/welcome" || url.pathname === "/welcome/";
      const pathname = isHome ? "/landing.html" : url.pathname;
      // The kit answers GET and HEAD and says no to anything else, which is a 405 here.
      if (!(await staticFiles(req, res, pathname))) throw new HttpError(405, "method not allowed");
      return;
    }
    let pathMatched = false;
    for (const entry of routes) {
      const match = entry.pattern.exec(url.pathname);
      if (!match) continue;
      pathMatched = true;
      if (entry.route.method !== method) continue;
      const params: Record<string, string> = {};
      entry.keys.forEach((key, index) => {
        try {
          params[key] = decodeURIComponent(match[index + 1]);
        } catch {
          throw new HttpError(400, "bad path");
        }
      });
      const user = entry.route.open ? await optionalUser(req) : await requiredUser(req);
      // An account from before email was required adds one first. Only the routes that do that stay open to it.
      if (user && !entry.route.open && !entry.route.allowNoEmail && needsEmail(user)) throw new HttpError(403, "add an email first");
      const body = await readBody(req, entry.route.maxBody ?? 16 * 1024, { message: "that upload is too large" });
      const result = await entry.route.handler({ ctx, user, params, query: url.searchParams, raw: req, body });
      if (result instanceof Reply) {
        if (result.bytes) sendBytes(res, result.status, result.bytes, result.headers);
        else sendJson(res, result.status, result.body, result.headers);
      } else {
        sendJson(res, 200, result);
      }
      return;
    }
    // Admin paths never admit they exist, not even through a wrong method.
    if (pathMatched) {
      if (url.pathname.startsWith("/api/admin/")) throw new HttpError(404, "not found");
      throw new HttpError(405, "method not allowed");
    }
    throw new HttpError(404, "not found");
  }

  async function optionalUser(req: http.IncomingMessage): Promise<User | null> {
    const token = bearerToken(req);
    return token ? ((await auth.userForToken(token)) ?? null) : null;
  }

  async function requiredUser(req: http.IncomingMessage): Promise<User> {
    const user = await optionalUser(req);
    if (!user) throw new HttpError(401, "sign in first");
    return user;
  }
}

/** Binary replies (photos) are private and revalidated, unlike JSON (no-store) and static files (no-cache). */
function sendBytes(res: http.ServerResponse, status: number, bytes: Buffer, headers: Record<string, string>): void {
  res.writeHead(status, { "content-length": bytes.length, ...SECURITY_HEADERS, "cache-control": "private, no-cache", ...headers });
  res.end(bytes);
}
