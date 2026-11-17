import { randomBytes, randomUUID } from "node:crypto";
import { generateRecoveryCode, hashSecret, normalizeEmail, normalizeRecoveryCode } from "./auth-code.ts";
import type { Mailer } from "./mailer.ts";

export type MaybePromise<T> = T | Promise<T>;

/** What the kit needs to know about a user. The app maps its row to this. */
export type AuthUser = {
  id: string;
  name: string;
  /** null for users created before email was required. */
  email: string | null;
  /** epoch ms, null until the verify link was used. */
  emailVerifiedAt: number | null;
};

export type LinkKind = "verify" | "recover";

export type AuthStore = {
  insertUser(user: { id: string; name: string; email: string; recoveryHash: string; createdAt: number }): MaybePromise<void>;
  findUserById(id: string): MaybePromise<AuthUser | undefined>;
  findUserByRecoveryHash(hash: string): MaybePromise<AuthUser | undefined>;
  /** Verified addresses only. An unverified address never matches. The app owns the unique index on verified emails. */
  findUserByVerifiedEmail(email: string): MaybePromise<AuthUser | undefined>;
  setRecoveryHash(userId: string, hash: string): MaybePromise<void>;
  /** Stores the new address and sets emailVerifiedAt to null. */
  setEmail(userId: string, email: string): MaybePromise<void>;
  /** Sets emailVerifiedAt only if the user's current email still equals `email`. False when it does not, or when another user already has this verified address (unique index). */
  markEmailVerified(userId: string, email: string, at: number): MaybePromise<boolean>;
  /** The app picks its own session id; the kit only knows the token hash. */
  insertSession(session: { userId: string; tokenHash: string; createdAt: number }): MaybePromise<void>;
  findUserBySessionHash(tokenHash: string): MaybePromise<AuthUser | undefined>;
  deleteSession(tokenHash: string): MaybePromise<void>;
  /** Deletes every session of the user except the one with `exceptTokenHash`. */
  deleteSessionsForUser(userId: string, exceptTokenHash?: string): MaybePromise<void>;
  insertLink(link: { tokenHash: string; userId: string; kind: LinkKind; email: string; expiresAt: number }): MaybePromise<void>;
  /** Atomic find-and-delete of one link of this kind: returns it only if it exists and `expiresAt > now`. An expired link is deleted and not returned. Single use depends on this being atomic. */
  takeLink(tokenHash: string, kind: LinkKind, now: number): MaybePromise<{ userId: string; email: string } | undefined>;
  deleteLinksForUser(userId: string, kind: LinkKind): MaybePromise<void>;
};

/** Same shape as the kit's createRateLimiter() result. */
export type AuthLimiter = { hit(key: string, now: number): boolean };

export type AuthOptions = {
  store: AuthStore;
  /** No mailer = email off: signup and setEmail send nothing, requestLostCode answers ok:true and sends nothing. */
  mailer?: Mailer;
  limiter: AuthLimiter;
  /** Full URL for a link the app serves, with the token in the fragment, e.g. `https://app.example/recover#t=${token}`. */
  linkUrl(kind: LinkKind, token: string): string;
  /** Shown in mail subjects and bodies. */
  appName: string;
  now?: () => number;
  /** Turns what a person typed into the secret that is hashed, or null. Default: normalizeRecoveryCode. */
  normalize?: (input: string) => string | null;
  /** Lost-code consume also signs out the user's other sessions. Default false. */
  revokeOtherSessions?: boolean;
  /** Lost-code consume also rotates the recovery code and returns the new one once. Default true. */
  rotateOnLostCode?: boolean;
  /** Server-side log for mail failures. Receives a fixed message plus the error name, never a token, address or body. Default console.error. */
  log?: (message: string) => void;
};

export type Auth = {
  /** New user. Email required. Creates a recovery code (shown once) and sends a verify link. Does not start a session. */
  signup(input: { name: string; email: string }): Promise<
    { ok: true; user: AuthUser; recoveryCode: string } | { ok: false; reason: "invalid_email" }
  >;
  /** Replaces the recovery code, old one stops working. Returns the new code. */
  rotateCode(userId: string): Promise<{ code: string }>;
  /** Sets or changes the address (also how an existing user adds one). Unverified until the link is used; sends a verify link, and calling it again with the same unverified address sends a fresh link (one live verify link per user); the same address when already verified is a no-op. Changing the address also kills the user's lost-code links. */
  setEmail(userId: string, email: string): Promise<
    { ok: true; user: AuthUser } | { ok: false; reason: "invalid_email" | "rate_limited" | "not_found" }
  >;
  /** Consumes a verify token. */
  verifyEmail(token: string): Promise<{ ok: true; user: AuthUser } | { ok: false; reason: "invalid" | "email_taken" }>;

  /** Recovery-code login. `ip` is the app's client key (right-most X-Forwarded-For on Railway). Starts a session. */
  loginByCode(input: { code: string; ip: string }): Promise<
    { ok: true; user: AuthUser; token: string } | { ok: false; reason: "invalid" | "rate_limited" }
  >;
  /** Lost-code mail. The answer never depends on whether the address exists or is verified; the mail goes out without being awaited so timing does not tell either. Only verified addresses get a link. */
  requestLostCode(input: { email: string; ip: string }): Promise<{ ok: true } | { ok: false; reason: "rate_limited" }>;
  /** Consumes a lost-code token (single use, 20 min), starts a new session, and by default rotates the recovery code, returning the new code once as `recoveryCode` (the app shows it). Opt out with `rotateOnLostCode: false`. */
  consumeLostCode(token: string): Promise<
    { ok: true; user: AuthUser; token: string; recoveryCode?: string } | { ok: false; reason: "invalid" }
  >;

  startSession(userId: string): Promise<{ token: string }>;
  /** The user for a session token, or undefined. Apps check needsEmail(user) here. */
  userForToken(token: string): Promise<AuthUser | undefined>;
  endSession(token: string): Promise<void>;
};

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RECOVER_TTL_MS = 20 * 60 * 1000;

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function createAuth(options: AuthOptions): Auth {
  if (!options || typeof options !== "object") throw new TypeError("createAuth: options are required");
  const { store, mailer, limiter, linkUrl, appName } = options;
  if (!store || typeof store !== "object") throw new TypeError("createAuth: store is required");
  if (!limiter || typeof limiter.hit !== "function") throw new TypeError("createAuth: limiter is required");
  if (typeof linkUrl !== "function") throw new TypeError("createAuth: linkUrl is required");
  if (typeof appName !== "string" || appName.trim() === "") throw new TypeError("createAuth: appName is required");

  const now = options.now ?? Date.now;
  const normalize = options.normalize ?? normalizeRecoveryCode;
  const revokeOthers = options.revokeOtherSessions ?? false;
  const rotateOnLostCode = options.rotateOnLostCode ?? true;
  const log = options.log ?? ((message: string) => console.error(message));

  /** Logs a fixed message and the error name. Never the message, address or token. */
  function logFailure(what: string, error: unknown): void {
    const name = error instanceof Error && typeof error.name === "string" ? error.name : "UnknownError";
    try {
      log(`auth: ${what} failed (${name})`);
    } catch {
      // A broken log must not turn into an unhandled rejection.
    }
  }

  async function newSession(userId: string): Promise<{ token: string; tokenHash: string }> {
    const token = newToken();
    const tokenHash = hashSecret(token);
    await store.insertSession({ userId, tokenHash, createdAt: now() });
    return { token, tokenHash };
  }

  /** Replaces the user's live verify link and mails the new one. Never throws on a mail failure. */
  async function sendVerifyLink(userId: string, email: string): Promise<void> {
    await store.deleteLinksForUser(userId, "verify");
    if (!mailer) return;
    const token = newToken();
    await store.insertLink({ tokenHash: hashSecret(token), userId, kind: "verify", email, expiresAt: now() + VERIFY_TTL_MS });
    const url = linkUrl("verify", token);
    try {
      await mailer.send({
        to: email,
        subject: `Confirm your email for ${appName}`,
        text: `Confirm your email address for ${appName} with this link:\n\n${url}\n\nIt works once and expires in 24 hours. If you did not ask for this, ignore this message.`,
        html: `<p>Confirm your email address for ${escapeHtml(appName)}:</p><p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p><p>The link works once and expires in 24 hours. If you did not ask for this, ignore this message.</p>`,
      });
    } catch (error) {
      logFailure("verify mail", error);
    }
  }

  /** The background half of requestLostCode. Throws are caught by the caller. */
  async function sendLostCodeLink(email: string, at: number): Promise<void> {
    if (!mailer) return;
    const user = await store.findUserByVerifiedEmail(email);
    if (!user) return;
    await store.deleteLinksForUser(user.id, "recover");
    const token = newToken();
    await store.insertLink({ tokenHash: hashSecret(token), userId: user.id, kind: "recover", email, expiresAt: at + RECOVER_TTL_MS });
    const url = linkUrl("recover", token);
    await mailer.send({
      to: email,
      subject: `Sign in to ${appName}`,
      text: `Use this link to sign in to ${appName}:\n\n${url}\n\nIt works once and expires in 20 minutes. If you did not ask for this, ignore this message.`,
      html: `<p>Use this link to sign in to ${escapeHtml(appName)}:</p><p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p><p>The link works once and expires in 20 minutes. If you did not ask for this, ignore this message.</p>`,
    });
  }

  return {
    async signup({ name, email }) {
      const normalized = normalizeEmail(email);
      if (normalized === null) return { ok: false, reason: "invalid_email" };
      const recoveryCode = generateRecoveryCode();
      const user: AuthUser = { id: randomUUID(), name, email: normalized, emailVerifiedAt: null };
      await store.insertUser({
        id: user.id,
        name,
        email: normalized,
        recoveryHash: hashSecret(recoveryCode),
        createdAt: now(),
      });
      await sendVerifyLink(user.id, normalized);
      return { ok: true, user, recoveryCode };
    },

    async rotateCode(userId) {
      const code = generateRecoveryCode();
      await store.setRecoveryHash(userId, hashSecret(code));
      return { code };
    },

    async setEmail(userId, email) {
      const normalized = normalizeEmail(email);
      if (normalized === null) return { ok: false, reason: "invalid_email" };
      const user = await store.findUserById(userId);
      if (!user) return { ok: false, reason: "not_found" };
      // The same address, already verified: nothing to change, and it must stay verified.
      if (user.email === normalized && user.emailVerifiedAt !== null) return { ok: true, user };
      if (!limiter.hit(`email:${userId}`, now())) return { ok: false, reason: "rate_limited" };
      await store.setEmail(userId, normalized);
      await store.deleteLinksForUser(userId, "recover");
      await sendVerifyLink(userId, normalized);
      return { ok: true, user: { ...user, email: normalized, emailVerifiedAt: null } };
    },

    async verifyEmail(token) {
      if (typeof token !== "string") return { ok: false, reason: "invalid" };
      const at = now();
      const link = await store.takeLink(hashSecret(token), "verify", at);
      if (!link) return { ok: false, reason: "invalid" };
      const user = await store.findUserById(link.userId);
      if (!user || user.email !== link.email) return { ok: false, reason: "invalid" };
      if (!(await store.markEmailVerified(user.id, link.email, at))) return { ok: false, reason: "email_taken" };
      return { ok: true, user: { ...user, emailVerifiedAt: at } };
    },

    async loginByCode({ code, ip }) {
      if (!limiter.hit(`code:${ip}`, now())) return { ok: false, reason: "rate_limited" };
      const secret = typeof code === "string" ? normalize(code) : null;
      if (secret === null) return { ok: false, reason: "invalid" };
      const user = await store.findUserByRecoveryHash(hashSecret(secret));
      if (!user) return { ok: false, reason: "invalid" };
      const session = await newSession(user.id);
      return { ok: true, user, token: session.token };
    },

    async requestLostCode({ email, ip }) {
      const at = now();
      const normalized = typeof email === "string" ? normalizeEmail(email) : null;
      // Both counters are always charged, so which one tripped says nothing about the address.
      const ipAllowed = limiter.hit(`lost:ip:${ip}`, at);
      const emailAllowed = normalized === null ? true : limiter.hit(`lost:email:${normalized}`, at);
      if (!ipAllowed || !emailAllowed) return { ok: false, reason: "rate_limited" };
      if (normalized !== null) {
        // Not awaited: the answer and its timing are the same whether or not a mail goes out.
        void sendLostCodeLink(normalized, at).catch((error: unknown) => logFailure("lost-code mail", error));
      }
      return { ok: true };
    },

    async consumeLostCode(token) {
      if (typeof token !== "string") return { ok: false, reason: "invalid" };
      const link = await store.takeLink(hashSecret(token), "recover", now());
      if (!link) return { ok: false, reason: "invalid" };
      const user = await store.findUserById(link.userId);
      if (!user || user.email !== link.email || user.emailVerifiedAt === null) return { ok: false, reason: "invalid" };
      await store.deleteLinksForUser(user.id, "recover");
      const session = await newSession(user.id);
      if (revokeOthers) await store.deleteSessionsForUser(user.id, session.tokenHash);
      if (!rotateOnLostCode) return { ok: true, user, token: session.token };
      const recoveryCode = generateRecoveryCode();
      await store.setRecoveryHash(user.id, hashSecret(recoveryCode));
      return { ok: true, user, token: session.token, recoveryCode };
    },

    async startSession(userId) {
      const session = await newSession(userId);
      return { token: session.token };
    },

    async userForToken(token) {
      if (typeof token !== "string" || token === "") return undefined;
      return await store.findUserBySessionHash(hashSecret(token));
    },

    async endSession(token) {
      if (typeof token !== "string" || token === "") return;
      await store.deleteSession(hashSecret(token));
    },
  };
}
