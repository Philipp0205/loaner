import type http from "node:http";
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "./config.js";
import type { PushSender } from "./push.js";
import { HttpError } from "./app-kit/index.ts";

export { HttpError };

export type Ctx = {
  db: DatabaseSync;
  config: Config;
  now: () => number;
  push: PushSender;
};

export type User = { id: string; name: string };

export type Req = {
  ctx: Ctx;
  /** Null on open routes without a token. */
  user: User | null;
  params: Record<string, string>;
  query: URLSearchParams;
  raw: http.IncomingMessage;
  /** Request body, already read and capped by the route's maxBody. */
  body: Buffer;
};

/** A handler returns a JSON value, or a Reply for a custom status or a binary body. */
export class Reply {
  constructor(
    public status: number,
    public body: unknown,
    public headers: Record<string, string> = {},
    public bytes?: Buffer,
  ) {}
}

export type Route = {
  method: string;
  path: string;
  /** Open routes run without a bearer token. */
  open?: boolean;
  /** Largest accepted body in bytes. Default 16 KB. */
  maxBody?: number;
  handler: (req: Req) => unknown | Promise<unknown>;
};

/** For routes that need a signed-in user. */
export function me(req: Req): User {
  if (!req.user) throw new HttpError(401, "sign in first");
  return req.user;
}

export function jsonBody(req: Req): Record<string, unknown> {
  const text = req.body.toString("utf8");
  if (!text.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new HttpError(400, "expected a JSON object");
  return parsed as Record<string, unknown>;
}
