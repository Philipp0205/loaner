import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SECURITY_HEADERS,
  buildCsp,
  healthHandler,
  isHealthRequest,
  readBody,
  sendJson,
  serveStatic,
} from "./app-kit/index.ts";
import { sha256 } from "./code.js";
import type { Config } from "./config.js";
import { get } from "./db.js";
import type { DatabaseSync } from "node:sqlite";
import type { PushSender } from "./push.js";
import { authRoutes } from "./routes-auth.js";
import { feedbackRoutes } from "./routes-feedback.js";
import { groupRoutes } from "./routes-groups.js";
import { itemRoutes } from "./routes-items.js";
import { messageRoutes } from "./routes-messages.js";
import { notificationRoutes } from "./routes-notifications.js";
import { requestRoutes } from "./routes-requests.js";
import { HttpError, Reply, type Ctx, type Route, type User } from "./types.js";

export type AppDeps = {
  db: DatabaseSync;
  config: Config;
  now: () => number;
  push: PushSender;
};

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

// The on-device photo suggester loads a pinned Transformers.js build from jsDelivr and its CLIP weights
// from Hugging Face, so those hosts are allowed for scripts and fetches. Nothing else is.
// Hugging Face answers a weight download with a 302 to its CDN (for example us.aws.cdn.hf.co), and the
// CDN host has several labels, so it is listed explicitly instead of relying on a single *.hf.co match.
const CDN = "https://cdn.jsdelivr.net";
const HF = ["https://huggingface.co", "https://*.huggingface.co", "https://*.hf.co", "https://*.cdn.hf.co", "https://*.xethub.hf.co"];

export const CONTENT_SECURITY_POLICY = buildCsp({
  "default-src": ["'self'"],
  "img-src": ["'self'", "blob:", "data:"],
  "media-src": ["'self'", "blob:"],
  "style-src": ["'self'"],
  "style-src-attr": ["'unsafe-inline'"],
  "script-src": ["'self'", "'wasm-unsafe-eval'", CDN],
  "worker-src": ["'self'", "blob:"],
  "connect-src": ["'self'", CDN, ...HF],
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
  const routes = compile([
    ...authRoutes(),
    ...groupRoutes(),
    ...itemRoutes(),
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
      // The kit handler does not touch the database. If this throws, the request fails with a 500.
      get(ctx.db, "SELECT 1 AS ok");
      healthHandler(req, res);
      return;
    }
    if (!url.pathname.startsWith("/api/")) {
      // The kit answers GET and HEAD and says no to anything else, which is a 405 here.
      if (!(await staticFiles(req, res, url.pathname))) throw new HttpError(405, "method not allowed");
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
      const user = entry.route.open ? optionalUser(req) : requiredUser(req);
      const body = await readCapped(req, entry.route.maxBody ?? 16 * 1024);
      const result = await entry.route.handler({ ctx, user, params, query: url.searchParams, raw: req, body });
      if (result instanceof Reply) {
        if (result.bytes) sendBytes(res, result.status, result.bytes, result.headers);
        else sendJson(res, result.status, result.body ?? null, result.headers);
      } else {
        sendJson(res, 200, result ?? null);
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

  function lookup(req: http.IncomingMessage): User | null {
    const header = req.headers.authorization ?? "";
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    if (!match) return null;
    return (
      get<User>(
        deps.db,
        "SELECT u.id, u.name FROM devices d JOIN users u ON u.id = d.user_id WHERE d.token_hash = ?",
        sha256(match[1]),
      ) ?? null
    );
  }

  function requiredUser(req: http.IncomingMessage): User {
    const user = lookup(req);
    if (!user) throw new HttpError(401, "sign in first");
    return user;
  }

  function optionalUser(req: http.IncomingMessage): User | null {
    return lookup(req);
  }
}

/** The kit's capped reader, with Loan some's own words for the 413. */
async function readCapped(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  try {
    return await readBody(req, limit);
  } catch (error) {
    if (error instanceof HttpError && error.status === 413) throw new HttpError(413, "that upload is too large");
    throw error;
  }
}

/** Binary replies (photos) are private and revalidated, unlike JSON (no-store) and static files (no-cache). */
function sendBytes(res: http.ServerResponse, status: number, bytes: Buffer, headers: Record<string, string>): void {
  res.writeHead(status, { "content-length": bytes.length, ...SECURITY_HEADERS, "cache-control": "private, no-cache", ...headers });
  res.end(bytes);
}
