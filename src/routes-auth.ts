import { clientKey, createRateLimiter, needsEmail, normalizeEmail, type Auth } from "./app-kit/index.ts";
import { run } from "./db.js";
import { unreadCount } from "./notify.js";
import { isoDate } from "./time.js";
import { joinGroup, groupByInvite } from "./routes-groups.js";
import { HttpError, bearerToken, jsonBody, me, type Route, type User } from "./types.js";
import { str, text } from "./validate.js";

/** What the app shows about the signed-in person. needsEmail is true for accounts from before email was required. */
function userView(user: User) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt,
    needsEmail: needsEmail(user),
  };
}

export function authRoutes(auth: Auth): Route[] {
  const startLimit = createRateLimiter({ limit: 60, windowMs: 60 * 60 * 1000 });

  return [
    {
      method: "POST",
      path: "/api/auth/start",
      open: true,
      async handler(req) {
        if (!startLimit.hit(clientKey(req.raw), req.ctx.now())) throw new HttpError(429, "too many new accounts from here, try again later");
        const body = jsonBody(req);
        const name = text(body.name, "name", 1, 24);
        if (normalizeEmail(str(body, "email")) === null) throw new HttpError(400, "that email does not look right");
        const invite = str(body, "inviteCode");
        // Check the invite before creating anyone, so a bad link leaves nothing behind.
        const group = invite ? groupByInvite(req.ctx, invite) : undefined;
        if (invite && !group) throw new HttpError(404, "that invite link does not work");
        const signup = await auth.signup({ name, email: str(body, "email") });
        if (!signup.ok) throw new HttpError(400, "that email does not look right");
        if (group) joinGroup(req.ctx, signup.user.id, group.id);
        const session = await auth.startSession(signup.user.id);
        return { token: session.token, recoveryCode: signup.recoveryCode, user: userView(signup.user), groupId: group?.id ?? null };
      },
    },
    {
      method: "POST",
      path: "/api/auth/recover",
      open: true,
      async handler(req) {
        const result = await auth.loginByCode({ code: str(jsonBody(req), "code"), ip: clientKey(req.raw) });
        if (!result.ok) {
          if (result.reason === "rate_limited") throw new HttpError(429, "too many attempts, wait a few minutes");
          throw new HttpError(401, "that recovery code did not work");
        }
        return { token: result.token, user: userView(result.user) };
      },
    },
    {
      // Always the same answer, so it cannot be used to find out who has an account. The mail goes out in the background.
      method: "POST",
      path: "/api/auth/lost-code",
      open: true,
      async handler(req) {
        const result = await auth.requestLostCode({ email: str(jsonBody(req), "email"), ip: clientKey(req.raw) });
        if (!result.ok) throw new HttpError(429, "too many attempts, wait a few minutes");
        return { ok: true };
      },
    },
    {
      // The link opens a page that posts the token here. A GET never uses it up, so a mail scanner cannot burn it.
      method: "POST",
      path: "/api/auth/lost-code/consume",
      open: true,
      async handler(req) {
        const result = await auth.consumeLostCode(str(jsonBody(req), "token"));
        if (!result.ok) throw new HttpError(400, "that link did not work, ask for a new one");
        return { token: result.token, user: userView(result.user), recoveryCode: result.recoveryCode ?? null };
      },
    },
    {
      method: "POST",
      path: "/api/auth/verify",
      open: true,
      async handler(req) {
        const result = await auth.verifyEmail(str(jsonBody(req), "token"));
        if (!result.ok) {
          if (result.reason === "email_taken") throw new HttpError(409, "that email is already used by another account");
          throw new HttpError(400, "that link did not work, ask for a new one");
        }
        return { ok: true };
      },
    },
    {
      method: "POST",
      path: "/api/auth/logout",
      allowNoEmail: true,
      async handler(req) {
        await auth.endSession(bearerToken(req.raw));
        return { ok: true };
      },
    },
    {
      method: "GET",
      path: "/api/me",
      allowNoEmail: true,
      handler(req) {
        const user = me(req);
        return { user: userView(user), unread: unreadCount(req.ctx, user.id), today: isoDate(req.ctx.now(), req.ctx.config.tz) };
      },
    },
    {
      method: "PATCH",
      path: "/api/me",
      handler(req) {
        const user = me(req);
        const name = text(jsonBody(req).name, "name", 1, 24);
        run(req.ctx.db, "UPDATE users SET name = ? WHERE id = ?", name, user.id);
        return { user: userView({ ...user, name }) };
      },
    },
    {
      // Replaces the recovery code. The old one stops working.
      method: "POST",
      path: "/api/me/recovery-code",
      async handler(req) {
        const user = me(req);
        const { code } = await auth.rotateCode(user.id);
        return { recoveryCode: code };
      },
    },
    ...(["PUT", "POST"] as const).map(
      (method): Route => ({
        // Adds or changes the address, and mails a fresh confirm link. Also how an older account gets its first email.
        method,
        path: "/api/me/email",
        allowNoEmail: true,
        async handler(req) {
          const user = me(req);
          const result = await auth.setEmail(user.id, str(jsonBody(req), "email"));
          if (!result.ok) {
            if (result.reason === "invalid_email") throw new HttpError(400, "that email does not look right");
            if (result.reason === "rate_limited") throw new HttpError(429, "too many tries, wait a few minutes");
            throw new HttpError(401, "sign in first");
          }
          return { user: userView(result.user) };
        },
      }),
    ),
  ];
}
