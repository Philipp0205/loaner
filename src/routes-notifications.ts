import { all, run } from "./db.js";
import { unreadCount } from "./notify.js";
import { HttpError, jsonBody, me, type Route } from "./types.js";
import { str } from "./validate.js";

type NoteRow = {
  id: string;
  type: string;
  title: string;
  body: string;
  item_id: string | null;
  request_id: string | null;
  created_at: number;
  read_at: number | null;
};

export function notificationRoutes(): Route[] {
  return [
    {
      method: "GET",
      path: "/api/notifications",
      handler(req) {
        const user = me(req);
        const rows = all<NoteRow>(
          req.ctx.db,
          "SELECT id, type, title, body, item_id, request_id, created_at, read_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id LIMIT 100",
          user.id,
        );
        return {
          unread: unreadCount(req.ctx, user.id),
          notifications: rows.map((row) => ({
            id: row.id,
            type: row.type,
            title: row.title,
            body: row.body,
            itemId: row.item_id,
            requestId: row.request_id,
            createdAt: row.created_at,
            read: row.read_at !== null,
          })),
        };
      },
    },
    {
      method: "POST",
      path: "/api/notifications/read",
      handler(req) {
        const user = me(req);
        run(req.ctx.db, "UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL", req.ctx.now(), user.id);
        return { unread: 0 };
      },
    },
    {
      method: "POST",
      path: "/api/notifications/:id/read",
      handler(req) {
        const user = me(req);
        const changed = run(req.ctx.db, "UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?", req.ctx.now(), req.params.id, user.id);
        if (changed === 0) throw new HttpError(404, "notification not found");
        return { unread: unreadCount(req.ctx, user.id) };
      },
    },
    {
      method: "POST",
      path: "/api/push/subscribe",
      handler(req) {
        const user = me(req);
        const body = jsonBody(req);
        const keys = (body.keys ?? {}) as Record<string, unknown>;
        const endpoint = str(body, "endpoint");
        const p256dh = typeof keys.p256dh === "string" ? keys.p256dh : "";
        const auth = typeof keys.auth === "string" ? keys.auth : "";
        if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000) throw new HttpError(400, "invalid push endpoint");
        if (!p256dh || !auth || p256dh.length > 256 || auth.length > 256) throw new HttpError(400, "invalid push keys");
        run(
          req.ctx.db,
          `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
          endpoint, user.id, p256dh, auth, req.ctx.now(),
        );
        return { ok: true };
      },
    },
    {
      method: "POST",
      path: "/api/push/unsubscribe",
      handler(req) {
        const user = me(req);
        run(req.ctx.db, "DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?", str(jsonBody(req), "endpoint"), user.id);
        return { ok: true };
      },
    },
  ];
}
