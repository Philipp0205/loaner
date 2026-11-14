import { newId, newToken, normalizeRecoveryCode, recoveryCode, sha256 } from "./code.js";
import { get, run, tx } from "./db.js";
import { unreadCount } from "./notify.js";
import { createRateLimiter } from "./rate-limit.js";
import { isoDate } from "./time.js";
import { joinGroup, groupByInvite } from "./routes-groups.js";
import { HttpError, jsonBody, me, type Ctx, type Route } from "./types.js";
import { str, text } from "./validate.js";

function addDevice(ctx: Ctx, userId: string): string {
  const token = newToken();
  run(ctx.db, "INSERT INTO devices (token_hash, user_id, created_at) VALUES (?, ?, ?)", sha256(token), userId, ctx.now());
  return token;
}

function ip(req: { raw: { socket: { remoteAddress?: string } } }): string {
  return req.raw.socket.remoteAddress ?? "unknown";
}

export function authRoutes(): Route[] {
  const startLimit = createRateLimiter({ limit: 60, windowMs: 60 * 60 * 1000 });
  const recoverLimit = createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 });

  return [
    {
      method: "POST",
      path: "/api/auth/start",
      open: true,
      handler(req) {
        if (!startLimit.hit(ip(req), req.ctx.now())) throw new HttpError(429, "too many new accounts from here, try again later");
        const body = jsonBody(req);
        const name = text(body.name, "name", 1, 24);
        const invite = str(body, "inviteCode");
        // Check the invite before creating anyone, so a bad link leaves nothing behind.
        const group = invite ? groupByInvite(req.ctx, invite) : undefined;
        if (invite && !group) throw new HttpError(404, "that invite link does not work");
        const code = recoveryCode();
        const userId = newId();
        const token = tx(req.ctx.db, () => {
          run(req.ctx.db, "INSERT INTO users (id, name, recovery_hash, created_at) VALUES (?, ?, ?, ?)", userId, name, sha256(code), req.ctx.now());
          if (group) joinGroup(req.ctx, userId, group.id);
          return addDevice(req.ctx, userId);
        });
        return { token, recoveryCode: code, user: { id: userId, name }, groupId: group?.id ?? null };
      },
    },
    {
      method: "POST",
      path: "/api/auth/recover",
      open: true,
      handler(req) {
        if (!recoverLimit.hit(ip(req), req.ctx.now())) throw new HttpError(429, "too many attempts, wait a few minutes");
        const code = normalizeRecoveryCode(str(jsonBody(req), "code"));
        const user = code ? get<{ id: string; name: string }>(req.ctx.db, "SELECT id, name FROM users WHERE recovery_hash = ?", sha256(code)) : undefined;
        if (!user) throw new HttpError(401, "that recovery code did not work");
        return { token: addDevice(req.ctx, user.id), user: { id: user.id, name: user.name } };
      },
    },
    {
      method: "POST",
      path: "/api/auth/logout",
      handler(req) {
        const header = req.raw.headers.authorization ?? "";
        run(req.ctx.db, "DELETE FROM devices WHERE token_hash = ?", sha256(header.replace(/^Bearer\s+/i, "")));
        return { ok: true };
      },
    },
    {
      method: "GET",
      path: "/api/me",
      handler(req) {
        const user = me(req);
        return { user, unread: unreadCount(req.ctx, user.id), today: isoDate(req.ctx.now(), req.ctx.config.tz) };
      },
    },
    {
      method: "PATCH",
      path: "/api/me",
      handler(req) {
        const user = me(req);
        const name = text(jsonBody(req).name, "name", 1, 24);
        run(req.ctx.db, "UPDATE users SET name = ? WHERE id = ?", name, user.id);
        return { user: { id: user.id, name } };
      },
    },
    {
      // Replaces the recovery code. The old one stops working.
      method: "POST",
      path: "/api/me/recovery-code",
      handler(req) {
        const user = me(req);
        const code = recoveryCode();
        run(req.ctx.db, "UPDATE users SET recovery_hash = ? WHERE id = ?", sha256(code), user.id);
        return { recoveryCode: code };
      },
    },
  ];
}

