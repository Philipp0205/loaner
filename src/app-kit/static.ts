import fs from "node:fs";
import type http from "node:http";
import path from "node:path";
import { SECURITY_HEADERS, sendJson } from "./http.ts";

export type StaticOptions = {
  /** Cache-Control for .html files and SPA fallbacks. Default "no-cache". */
  htmlCacheControl?: string;
  /** Cache-Control for every other file. Default "no-cache". */
  cacheControl?: string;
  /**
   * Per-path override, called with the path relative to root using "/" separators
   * (for example "vendor/leaflet.js"). Return a Cache-Control value, or undefined to keep the default.
   */
  cacheFor?: (relativePath: string) => string | undefined;
  /** File served for an extensionless path. Default "index.html". Set to false to turn the SPA fallback off. */
  fallback?: string | false;
  /** Extra or replacement content types by extension, for example { ".wasm": "application/wasm" }. */
  mime?: Record<string, string>;
};

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
};

export type StaticHandler = (req: http.IncomingMessage, res: http.ServerResponse, pathname: string) => Promise<boolean>;

/**
 * Serves files under `root`. The handler returns true when it answered, false when the request
 * is not for it (a method other than GET and HEAD), so the app can go on to its own routes or a 405.
 *
 *  - The path is percent-decoded. Malformed encoding, a NUL byte, or a ".." segment is a 400.
 *  - The resolved real path must stay inside the real root, so a symlink cannot lead out of it.
 *  - A path with no extension serves the fallback (index.html) for single-page apps.
 *  - A path with an extension that has no file is a 404 JSON error.
 */
export function serveStatic(root: string, options: StaticOptions = {}): StaticHandler {
  const absoluteRoot = path.resolve(root);
  const htmlCache = options.htmlCacheControl ?? "no-cache";
  const otherCache = options.cacheControl ?? "no-cache";
  const fallback = options.fallback === undefined ? "index.html" : options.fallback;
  const mime = { ...MIME, ...options.mime };
  let realRoot: string | undefined;

  async function getRealRoot(): Promise<string> {
    realRoot ??= await fs.promises.realpath(absoluteRoot);
    return realRoot;
  }

  return async (req, res, pathname) => {
    if (req.method !== "GET" && req.method !== "HEAD") return false;

    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      sendJson(res, 400, { error: "bad path" });
      return true;
    }
    if (decoded.includes("\0") || decoded.split(/[\\/]/).includes("..")) {
      sendJson(res, 400, { error: "bad path" });
      return true;
    }

    const rel = decoded.replace(/^\/+/, "");
    const filePath = path.resolve(absoluteRoot, rel);
    if (filePath !== absoluteRoot && !filePath.startsWith(absoluteRoot + path.sep)) {
      sendJson(res, 404, { error: "not found" });
      return true;
    }

    let ext = path.extname(rel).toLowerCase();
    let target = filePath;
    if (!ext) {
      if (fallback === false) {
        sendJson(res, 404, { error: "not found" });
        return true;
      }
      target = path.resolve(absoluteRoot, fallback);
      ext = path.extname(fallback).toLowerCase();
    }

    let data: Buffer;
    try {
      const rootReal = await getRealRoot();
      const real = await fs.promises.realpath(target);
      if (!real.startsWith(rootReal + path.sep)) {
        sendJson(res, 404, { error: "not found" });
        return true;
      }
      const stat = await fs.promises.stat(real);
      if (!stat.isFile()) {
        sendJson(res, 404, { error: "not found" });
        return true;
      }
      data = await fs.promises.readFile(real);
    } catch {
      sendJson(res, 404, { error: "not found" });
      return true;
    }

    const relative = path.relative(absoluteRoot, target).split(path.sep).join("/");
    const isHtml = ext === ".html";
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      "content-type": mime[ext] ?? "application/octet-stream",
      "content-length": data.length,
      "cache-control": options.cacheFor?.(relative) ?? (isHtml ? htmlCache : otherCache),
    });
    if (req.method === "HEAD") res.end();
    else res.end(data);
    return true;
  };
}
