import type http from "node:http";

/** An error that carries the HTTP status to answer with. Its message is safe to show to the caller. */
export class HttpError extends Error {
  readonly status: number;
  /** Optional machine-readable code for the app's own logs and branching. Not sent in the body. */
  readonly code: string | undefined;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Headers every response carries. content-type is per response and is not part of this set.
 * Pass overrides through the `extraHeaders` argument of sendJson.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
});

/** Default cap for readJson: 16 KiB. */
export const DEFAULT_JSON_MAX_BYTES = 16 * 1024;

/**
 * Reads the whole request body, at most `maxBytes`.
 * Over the cap it rejects with HttpError 413 and keeps none of the body: the rest of the
 * upload is read and thrown away, so the connection can still answer and be reused.
 * A declared Content-Length over the cap is rejected before any data is kept.
 * `options.message` is the 413 message (default "body too large").
 */
export function readBody(req: http.IncomingMessage, maxBytes: number, options: { message?: string } = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let chunks: Buffer[] = [];
    let size = 0;
    let over = false;

    function overflow(): void {
      if (over) return;
      over = true;
      chunks = [];
      reject(new HttpError(413, options.message ?? "body too large", "body_too_large"));
    }

    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > maxBytes) overflow();

    // A "data" listener keeps the stream flowing, so an oversize body is drained, not buffered.
    req.on("data", (chunk: Buffer) => {
      if (over) return;
      size += chunk.length;
      if (size > maxBytes) {
        overflow();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!over) resolve(Buffer.concat(chunks));
    });
    req.on("error", (error) => {
      if (!over) reject(error);
    });
    // A client that hangs up mid-upload. No-op once the promise has settled.
    req.on("close", () => {
      if (!over) reject(new HttpError(400, "request aborted", "aborted"));
    });
  });
}

/**
 * Reads a JSON object body. An empty body is `{}`.
 * 400 for invalid JSON or a body that is not an object, 413 over `max` bytes (default 16 KiB).
 */
export async function readJson(
  req: http.IncomingMessage,
  options: { max?: number } = {},
): Promise<Record<string, unknown>> {
  const buffer = await readBody(req, options.max ?? DEFAULT_JSON_MAX_BYTES);
  const text = buffer.toString("utf8");
  if (!text.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid JSON", "invalid_json");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "expected a JSON object", "invalid_json");
  }
  return parsed as Record<string, unknown>;
}

/** Sends a JSON body with the shared security headers. `extraHeaders` win over them. 204 sends no body. An undefined body sends `null`. */
export function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  if (status === 204) {
    sendEmpty(res, 204);
    return;
  }
  const json = JSON.stringify(body ?? null);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json),
    ...SECURITY_HEADERS,
    ...extraHeaders,
  });
  res.end(json);
}

/** Sends a response with no body and the shared security headers. */
export function sendEmpty(res: http.ServerResponse, status: number): void {
  res.writeHead(status, { ...SECURITY_HEADERS });
  res.end();
}

/**
 * The status and JSON body for an error. An HttpError shows its message.
 * Anything else is a 500 with a fixed message, so internals never leak.
 */
export function errorBody(error: unknown): { status: number; body: { error: string } } {
  if (error instanceof HttpError) return { status: error.status, body: { error: error.message } };
  return { status: 500, body: { error: "internal error" } };
}

/**
 * Answers with errorBody(error). Unknown errors are passed to `log` (default console.error)
 * and are never sent to the caller. If the response has already started, it is just ended.
 */
export function sendError(
  res: http.ServerResponse,
  error: unknown,
  log: (error: unknown) => void = (e) => console.error("unhandled error", e),
): void {
  if (!(error instanceof HttpError)) log(error);
  if (res.headersSent) {
    res.end();
    return;
  }
  const { status, body } = errorBody(error);
  sendJson(res, status, body);
}
