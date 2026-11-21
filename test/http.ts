import http from "node:http";
import type { AddressInfo } from "node:net";
import type { DatabaseSync } from "node:sqlite";
import { hashSecret, stubMailer, type Mailer, type MailMessage } from "../src/app-kit/index.ts";
import { createApp } from "../src/app.js";
import { createGroupChat, type GroupChat } from "../src/chat/service.js";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db.js";
import type { PushPayload, PushSender, PushSubscription } from "../src/push.js";
import type { Ctx } from "../src/types.js";

// Shared by the API tests. Not a test file: `npm test` only runs `test/*.test.ts`.

/** 2026-06-01 15:00 UTC, a Monday. */
export const START = Date.parse("2026-06-01T15:00:00.000Z");
export const DAY = 86_400_000;

export type SentPush = { endpoint: string; payload: PushPayload };

export type AppCtx = {
  port: number;
  db: DatabaseSync;
  /** What the recording push sender was asked to send. */
  sent: SentPush[];
  /** The same context the app uses, for calling runReminders directly. */
  ctx: Ctx;
  /** The group chat the app uses: flush(true) sends the queued chat pushes now. */
  chat: GroupChat;
  /** The mail stub: every message the app tried to send, in order. */
  mail: Mailer & { sent: MailMessage[] };
  advance: (ms: number) => void;
  at: (ms: number) => void;
};

export type WithAppOptions = {
  env?: NodeJS.ProcessEnv;
  push?: PushSender;
  /** Replaces the mail stub, for example one that always throws. `app.mail` is still the stub. */
  mailer?: Mailer;
};

export async function withApp(fn: (app: AppCtx) => Promise<void>, options: WithAppOptions = {}): Promise<void> {
  const sent: SentPush[] = [];
  let now = START;
  const db = openDb(":memory:");
  const push: PushSender = options.push ?? {
    async send(subscription: PushSubscription, payload: PushPayload) {
      sent.push({ endpoint: subscription.endpoint, payload });
    },
  };
  const config = loadConfig({ PORT: "3000", DB_PATH: ":memory:", APP_TZ: "UTC", ...options.env });
  const mail = stubMailer();
  const ctx: Ctx = { db, config, push, now: () => now };
  // The group chat is made here so a test can flush its push batcher instead of waiting out the window.
  const chat = createGroupChat(ctx);
  const server = http.createServer(createApp({ ...ctx, mailer: options.mailer ?? mail, chat }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  // Links in mail point at this server, so a test can open them.
  config.appOrigin = `http://127.0.0.1:${port}`;
  try {
    await fn({
      port, db, sent, ctx, mail, chat,
      advance(ms) { now += ms; },
      at(ms) { now = ms; },
    });
  } finally {
    chat.dispose();
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
}

export type ApiOptions = { token?: string; body?: unknown; raw?: Buffer; contentType?: string; headers?: Record<string, string> };

export async function api(app: { port: number }, method: string, pathname: string, options: ApiOptions = {}): Promise<{ status: number; json: any; bytes: Buffer; type: string }> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  let body: string | Blob | undefined;
  if (options.raw) {
    body = new Blob([new Uint8Array(options.raw)]);
    headers["content-type"] = options.contentType ?? "application/octet-stream";
  } else if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    headers["content-type"] = "application/json";
  }
  const response = await fetch(`http://127.0.0.1:${app.port}${pathname}`, { method, headers, body });
  const bytes = Buffer.from(await response.arrayBuffer());
  const type = response.headers.get("content-type") ?? "";
  let json: any = null;
  if (type.includes("json") && bytes.length) json = JSON.parse(bytes.toString("utf8"));
  return { status: response.status, json, bytes, type };
}

/** Calls the API and fails the test on any status other than the expected one (default 200). */
export async function ok(app: { port: number }, method: string, pathname: string, options: ApiOptions & { status?: number } = {}): Promise<any> {
  const res = await api(app, method, pathname, options);
  const want = options.status ?? 200;
  if (res.status !== want) throw new Error(`${method} ${pathname} -> ${res.status} (wanted ${want}) ${res.bytes.toString("utf8").slice(0, 200)}`);
  return res.json;
}

export type Person = { token: string; id: string; name: string; email: string; code: string };

/** The default address for a test person: the name, lowercased, at example.com. */
export const emailFor = (name: string): string => `${name.toLowerCase().replace(/[^a-z0-9]/g, "") || "user"}@example.com`;

export async function signUp(app: { port: number }, name: string, inviteCode?: string, email = emailFor(name)): Promise<Person> {
  const json = await ok(app, "POST", "/api/auth/start", { body: { name, email, ...(inviteCode ? { inviteCode } : {}) } });
  return { token: json.token, id: json.user.id, name, email, code: json.recoveryCode };
}

/** An account from before email was required: a row with no email, a device token and a recovery code. */
export function seedLegacyUser(app: { db: DatabaseSync }, name: string): Person {
  const id = `legacy-${name.toLowerCase()}`;
  const token = `legacy-token-${name.toLowerCase()}`;
  const code = "ABCD-EFGH-JKLM";
  app.db
    .prepare("INSERT INTO users (id, name, recovery_hash, created_at) VALUES (?, ?, ?, ?)")
    .run(id, name, hashSecret(code), START);
  app.db.prepare("INSERT INTO devices (token_hash, user_id, created_at) VALUES (?, ?, ?)").run(hashSecret(token), id, START);
  return { token, id, name, email: "", code };
}

/** Lets the fire-and-forget mail of a lost-code request finish before a test looks at the stub. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

/** The token in the link of a mail: `.../verify#t=TOKEN` or `.../recover#t=TOKEN`. */
export function linkToken(message: MailMessage | undefined, kind: "verify" | "recover"): string {
  const match = new RegExp(`/${kind}#t=([A-Za-z0-9_-]+)`).exec(message?.text ?? "");
  if (!match) throw new Error(`no ${kind} link in the mail`);
  return match[1];
}

export async function makeGroup(app: { port: number }, who: Person, name: string): Promise<{ id: string; inviteCode: string }> {
  const json = await ok(app, "POST", "/api/groups", { token: who.token, body: { name } });
  return { id: json.group.id, inviteCode: json.group.inviteCode };
}

export async function joinWith(app: { port: number }, who: Person, inviteCode: string): Promise<void> {
  await ok(app, "POST", `/api/invites/${inviteCode}/join`, { token: who.token });
}

export async function makeItem(app: { port: number }, who: Person, groupIds: string[], extra: Record<string, unknown> = {}): Promise<string> {
  const json = await ok(app, "POST", "/api/items", { token: who.token, status: 201, body: { name: "Cordless drill", note: "Battery lasts 30 min", groupIds, ...extra } });
  return json.item.id;
}

/** A valid 1x1 PNG. */
export const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

export function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
