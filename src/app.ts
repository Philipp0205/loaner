import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "./code.js";
import type { Config } from "./config.js";
import { get } from "./db.js";
import type { DatabaseSync } from "node:sqlite";
import type { PushSender } from "./push.js";
import { authRoutes } from "./routes-auth.js";
import { feedbackRoutes } from "./routes-feedback.js";
import { groupRoutes } from "./routes-groups.js";
import { itemRoutes } from "./routes-items.js";
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

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
};

// The on-device photo suggester loads a pinned Transformers.js build from jsDelivr and its CLIP weights
// from Hugging Face, so those two hosts are allowed for scripts and fetches. Nothing else is.
const CDN = "https://cdn.jsdelivr.net";
const HF = "https://huggingface.co https://*.huggingface.co https://*.hf.co";

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "content-security-policy":
    `default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self'; style-src-attr 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval' ${CDN}; connect-src 'self' ${CDN} ${HF}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`,
};

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
    if (!url.pathname.startsWith("/api/")) {
      if (method !== "GET" && method !== "HEAD") throw new HttpError(405, "method not allowed");
      await serveStatic(req, res, url.pathname);
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
      const body = await readBody(req, entry.route.maxBody ?? 16 * 1024);
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

/** Reads the whole body up to `limit` bytes. Over the limit it drains the rest and answers 413. */
function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooBig = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        tooBig = true;
        chunks.length = 0;
        return;
      }
      if (!tooBig) chunks.push(chunk);
    });
    req.on("end", () => (tooBig ? reject(new HttpError(413, "that upload is too large")) : resolve(Buffer.concat(chunks))));
    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const json = JSON.stringify(body ?? null);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json),
    "cache-control": "no-store",
    ...SECURITY_HEADERS,
    ...headers,
  });
  res.end(json);
}

function sendBytes(res: http.ServerResponse, status: number, bytes: Buffer, headers: Record<string, string>): void {
  res.writeHead(status, { "content-length": bytes.length, "cache-control": "private, no-cache", ...SECURITY_HEADERS, ...headers });
  res.end(bytes);
}

async function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): Promise<void> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, "bad path");
  }
  if (decoded.includes("\0")) throw new HttpError(400, "bad path");
  const filePath = path.resolve(PUBLIC_DIR, decoded.replace(/^\/+/, ""));
  const relative = path.relative(PUBLIC_DIR, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new HttpError(404, "not found");
  const ext = path.extname(relative);
  // A path with no extension is an app route such as /join/ABC: serve the app shell.
  const file = ext ? filePath : path.join(PUBLIC_DIR, "index.html");
  let data: Buffer;
  try {
    data = await fs.promises.readFile(file);
  } catch {
    throw new HttpError(404, "not found");
  }
  res.writeHead(200, {
    "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
    "content-length": data.length,
    "cache-control": "no-cache",
    ...SECURITY_HEADERS,
  });
  res.end(req.method === "HEAD" ? undefined : data);
}
