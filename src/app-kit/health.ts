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
 * It needs no router and no app state. Without `check` it does not look at the database.
 *
 * With a `check` function it returns a Promise<boolean> instead, and runs the check on GET and HEAD of the
 * health path (after the method test, so other methods stay 405 and never run it):
 *
 *   if (await healthHandler(req, res, () => db.prepare("select 1").get())) return;
 *
 * A check that throws or rejects answers 503 {"ok":false}. Nothing of the error is sent.
 */
export function healthHandler(req: Pick<http.IncomingMessage, "url" | "method">, res: http.ServerResponse): boolean;
export function healthHandler(
  req: Pick<http.IncomingMessage, "url" | "method">,
  res: http.ServerResponse,
  check: () => unknown | Promise<unknown>,
): Promise<boolean>;
export function healthHandler(
  req: Pick<http.IncomingMessage, "url" | "method">,
  res: http.ServerResponse,
  check?: () => unknown | Promise<unknown>,
): boolean | Promise<boolean> {
  if (check === undefined) return answer(req, res, 200);
  if (!isHealthRequest(req)) return Promise.resolve(false);
  if (req.method !== "GET" && req.method !== "HEAD") return Promise.resolve(answer(req, res, 200));
  return (async () => {
    let status: 200 | 503 = 200;
    try {
      await check();
    } catch {
      status = 503;
    }
    return answer(req, res, status);
  })();
}

function answer(req: Pick<http.IncomingMessage, "url" | "method">, res: http.ServerResponse, status: 200 | 503): boolean {
  if (!isHealthRequest(req)) return false;
  const body = { ok: status === 200 };
  if (req.method === "GET") {
    sendJson(res, status, body);
  } else if (req.method === "HEAD") {
    const json = JSON.stringify(body);
    res.writeHead(status, {
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
