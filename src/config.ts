import path from "node:path";
import { assertTimeZone } from "./time.js";

export type VapidConfig = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

export type Config = {
  port: number;
  /** ":memory:" or an absolute file path. */
  dbPath: string;
  /** IANA zone used for "today" and "tomorrow" in requests and reminders. */
  tz: string;
  /** Null unless both VAPID keys are set. Without it nothing is pushed. */
  vapid: VapidConfig | null;
  /** Bearer token for the feedback admin routes. Null when unset, and then those routes answer 404. */
  adminToken: string | null;
  /** Null when unset. Without it no mail is sent: sign-up still works, links just never arrive. */
  resendApiKey: string | null;
  /** The From header of every mail. */
  mailFrom: string;
  /** Public origin used in email links, no trailing slash. */
  appOrigin: string;
};

export const ADMIN_TOKEN_MIN = 32;
export const DEFAULT_VAPID_SUBJECT = "https://www.loanso.me";
export const DEFAULT_MAIL_FROM = "Loan some <hello@loanso.me>";

export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): Config {
  const rawDb = env.DB_PATH?.trim() ?? "";
  const dbPath = rawDb === ":memory:" ? rawDb : rawDb ? path.resolve(cwd, rawDb) : path.join(cwd, "data", "loaner.db");
  const tz = env.APP_TZ?.trim() || "UTC";
  assertTimeZone(tz);
  const port = readPort(env.PORT);
  return {
    port,
    dbPath,
    tz,
    vapid: readVapid(env),
    adminToken: readAdminToken(env),
    resendApiKey: env.RESEND_API_KEY?.trim() || null,
    mailFrom: env.MAIL_FROM?.trim() || DEFAULT_MAIL_FROM,
    appOrigin: readOrigin(env, port),
  };
}

function readOrigin(env: NodeJS.ProcessEnv, port: number): string {
  const raw = env.APP_ORIGIN?.trim().replace(/\/+$/, "") ?? "";
  if (!raw) return isProduction(env) ? "https://www.loanso.me" : `http://localhost:${port}`;
  if (!/^https?:\/\/[^\s/]+$/i.test(raw)) throw new Error("APP_ORIGIN must be an http(s) origin such as https://www.loanso.me");
  return raw;
}

function readAdminToken(env: NodeJS.ProcessEnv): string | null {
  const token = env.FEEDBACK_ADMIN_TOKEN?.trim() ?? "";
  if (!token) return null;
  // Fail loudly rather than run with a guessable token. The value is never echoed.
  if (token.length < ADMIN_TOKEN_MIN) throw new Error(`FEEDBACK_ADMIN_TOKEN must be at least ${ADMIN_TOKEN_MIN} characters, or unset`);
  return token;
}

function readPort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 3000;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid PORT: ${value}`);
  return port;
}

function readVapid(env: NodeJS.ProcessEnv): VapidConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = env.VAPID_PRIVATE_KEY?.trim() ?? "";
  const subject = env.VAPID_SUBJECT?.trim() || DEFAULT_VAPID_SUBJECT;
  if (!publicKey && !privateKey) return null;
  if (!publicKey || !privateKey) throw new Error("Set both VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY, or neither");
  if (!subject.startsWith("mailto:") && !subject.startsWith("https:")) {
    throw new Error("VAPID_SUBJECT must be a mailto: or https: URL");
  }
  if (isProduction(env) && subject.toLowerCase().includes("localhost")) {
    throw new Error("VAPID_SUBJECT must not point at localhost in production, use a real mailto: or https: URL");
  }
  return { publicKey, privateKey, subject };
}

export function isProduction(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === "production" || env.RAILWAY_ENVIRONMENT === "production";
}
