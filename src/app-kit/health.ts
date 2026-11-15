import type http from "node:http";
import { SECURITY_HEADERS, sendJson } from "./http.ts";

/** The path the kit answers. Railway's healthcheckPath points here. */
export const HEALTH_PATH = "/api/health";

/** True when the request is for the health path, whatever the method. The query string is ignored. */
export function isHealthRequest(req: Pick<http.IncomingMessage, "url">): boolean {
  const raw = req.url ?? "";
  const end = raw.search(/[?#]/);
  return (end < 0 ? raw : raw.slice(0, end)) === HEALTH_PATH;
}

/**
 * Answers GET and HEAD on /api/health with 200 {"ok":true}, and any other method with 405 and an Allow header.
 * Returns true when it answered, false for any other path, so it can sit in front of an app's own routing:
 *
 *   if (healthHandler(req, res)) return;
 *
 * It needs no router and no app state. It does not check the database.
 */
export function healthHandler(req: Pick<http.IncomingMessage, "url" | "method">, res: http.ServerResponse): boolean {
  if (!isHealthRequest(req)) return false;
  if (req.method === "GET") {
    sendJson(res, 200, { ok: true });
  } else if (req.method === "HEAD") {
    const json = JSON.stringify({ ok: true });
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(json),
      ...SECURITY_HEADERS,
    });
    res.end();
  } else {
    sendJson(res, 405, { error: "method not allowed" }, { allow: "GET, HEAD" });
  }
  return true;
}
