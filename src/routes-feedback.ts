import { requireAdmin } from "./admin-auth.js";
import { newId } from "./code.js";
import { all, get, run } from "./db.js";
import { createRateLimiter } from "./rate-limit.js";
import { MAX_PHOTO_BYTES, sniff } from "./routes-items.js";
import { HttpError, Reply, jsonBody, me, type Route } from "./types.js";

export const FEEDBACK_MAX = 2000;
export const FEEDBACK_STATUSES = ["new", "seen", "done"] as const;
type Status = (typeof FEEDBACK_STATUSES)[number];

const VERSION_MAX = 64;
const USER_AGENT_MAX = 200;
const LIST_CAP = 200;
/** Ten sends per person per hour. */
const SEND_LIMIT = { limit: 10, windowMs: 60 * 60 * 1000 };

type Row = {
  id: string;
  user_id: string;
  display_name: string;
  text: string;
  app_version: string | null;
  user_agent: string | null;
  created_at: number;
  status: string;
  has_photo: number;
};

const SELECT = `SELECT id, user_id, display_name, text, app_version, user_agent, created_at, status, photo IS NOT NULL AS has_photo FROM feedback`;

function view(row: Row) {
  return {
    id: row.id,
    userId: row.user_id,
    displayName: row.display_name,
    text: row.text,
    appVersion: row.app_version,
    userAgent: row.user_agent,
    createdAt: Number(row.created_at),
    status: row.status,
    hasPhoto: !!row.has_photo,
  };
}

/** Line breaks and tabs survive, other control characters go. 1 to 2000 characters after trimming. */
function feedbackText(value: unknown): string {
  const message = `feedback must be 1 to ${FEEDBACK_MAX} characters`;
  if (typeof value !== "string") throw new HttpError(400, message);
  const cleaned = value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .trim();
  const length = [...cleaned].length;
  if (length < 1 || length > FEEDBACK_MAX) throw new HttpError(400, message);
  return cleaned;
}

/** A build label such as a changelog id. Odd input is dropped, not rejected. */
function cleanVersion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.replace(/[^\x20-\x7e]/g, "").trim().slice(0, VERSION_MAX) || null;
}

function cleanUserAgent(value: string | undefined): string | null {
  return (value ?? "").replace(/[^\x20-\x7e]/g, "").trim().slice(0, USER_AGENT_MAX) || null;
}

/** An ISO date or time, as a ms instant. A "+" in a time zone offset can arrive as a space. */
function parseSince(raw: string): number {
  const value = raw.trim().replace(" ", "+");
  const instant = /^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(value) ? Date.parse(value) : NaN;
  if (!Number.isFinite(instant)) throw new HttpError(400, "since must be an ISO date or time");
  return instant;
}

export function feedbackRoutes(): Route[] {
  const sendLimit = createRateLimiter(SEND_LIMIT);

  return [
    {
      method: "POST",
      path: "/api/feedback",
      // 2000 characters can be 24 KB once JSON escaped.
      maxBody: 48 * 1024,
      handler(req) {
        const user = me(req);
        const body = jsonBody(req);
        const text = feedbackText(body.text);
        // Only valid sends count against the limit.
        if (!sendLimit.hit(user.id, req.ctx.now())) throw new HttpError(429, "That is a lot of feedback at once. Try again later.");
        const id = newId();
        run(
          req.ctx.db,
          "INSERT INTO feedback (id, user_id, display_name, text, app_version, user_agent, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'new')",
          id, user.id, user.name, text, cleanVersion(body.appVersion), cleanUserAgent(req.raw.headers["user-agent"]), req.ctx.now(),
        );
        return new Reply(201, { id });
      },
    },
    {
      // Optional screenshot, sent after the text like an item photo: raw bytes, once, by the sender.
      method: "PUT",
      path: "/api/feedback/:id/photo",
      maxBody: MAX_PHOTO_BYTES,
      handler(req) {
        const user = me(req);
        const row = get<{ user_id: string; has_photo: number }>(req.ctx.db, "SELECT user_id, photo IS NOT NULL AS has_photo FROM feedback WHERE id = ?", req.params.id);
        if (!row || row.user_id !== user.id) throw new HttpError(404, "not found");
        if (row.has_photo) throw new HttpError(409, "this feedback already has a photo");
        const declared = (req.raw.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
        if (!["image/jpeg", "image/png", "image/webp"].includes(declared)) throw new HttpError(415, "photo must be a JPEG, PNG or WebP image");
        if (req.body.length === 0) throw new HttpError(400, "photo is empty");
        if (sniff(req.body) !== declared) throw new HttpError(415, "that file is not a valid image of the declared type");
        run(req.ctx.db, "UPDATE feedback SET photo = ?, photo_type = ? WHERE id = ?", req.body, declared, req.params.id);
        return { ok: true };
      },
    },
    // The admin routes are open (no device token) and check FEEDBACK_ADMIN_TOKEN themselves.
    {
      method: "GET",
      path: "/api/admin/feedback",
      open: true,
      handler(req) {
        requireAdmin(req);
        const since = req.query.get("since");
        const rows =
          since === null || since === ""
            ? all<Row>(req.ctx.db, `${SELECT} ORDER BY created_at DESC, rowid DESC LIMIT ${LIST_CAP}`)
            : all<Row>(req.ctx.db, `${SELECT} WHERE created_at > ? ORDER BY created_at DESC, rowid DESC LIMIT ${LIST_CAP}`, parseSince(since));
        return { feedback: rows.map(view) };
      },
    },
    {
      method: "PATCH",
      path: "/api/admin/feedback/:id",
      open: true,
      handler(req) {
        requireAdmin(req);
        const status = jsonBody(req).status;
        if (typeof status !== "string" || !(FEEDBACK_STATUSES as readonly string[]).includes(status)) {
          throw new HttpError(400, `status must be one of ${FEEDBACK_STATUSES.join(", ")}`);
        }
        const changed = run(req.ctx.db, "UPDATE feedback SET status = ? WHERE id = ?", status as Status, req.params.id);
        if (!changed) throw new HttpError(404, "not found");
        return { feedback: view(get<Row>(req.ctx.db, `${SELECT} WHERE id = ?`, req.params.id) as Row) };
      },
    },
    {
      method: "GET",
      path: "/api/admin/feedback/:id/photo",
      open: true,
      handler(req) {
        requireAdmin(req);
        const row = get<{ photo: Uint8Array | null; photo_type: string | null }>(req.ctx.db, "SELECT photo, photo_type FROM feedback WHERE id = ?", req.params.id);
        if (!row || !row.photo || !row.photo_type) throw new HttpError(404, "not found");
        return new Reply(200, null, { "content-type": row.photo_type }, Buffer.from(row.photo));
      },
    },
  ];
}
