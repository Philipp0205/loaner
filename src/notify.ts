import { all, get, run } from "./db.js";
import { newId } from "./code.js";
import type { PushSubscription } from "./push.js";
import type { Ctx } from "./types.js";

export type NoteType =
  | "request_new"
  | "request_cancelled"
  | "approved"
  | "declined"
  | "blocked"
  | "handed_over"
  | "returned"
  | "item_removed"
  | "reminder"
  | "late"
  | "message";

export type NoteInput = {
  userId: string;
  type: NoteType;
  title: string;
  body: string;
  itemId?: string | null;
  requestId?: string | null;
  /** For a message note: the borrower of the thread, so the alert can open it. */
  borrowerId?: string | null;
  /** Push tag. Defaults to the type plus the request or item id. */
  tag?: string;
};

/**
 * Records an in-app notification. Returns the push to deliver, which the caller awaits
 * with flush() once its database work is done. Nothing here throws on a push failure.
 */
export function addNote(ctx: Ctx, input: NoteInput): PendingPush {
  run(
    ctx.db,
    "INSERT INTO notifications (id, user_id, type, title, body, item_id, request_id, created_at, borrower_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    newId(),
    input.userId,
    input.type,
    input.title,
    input.body,
    input.itemId ?? null,
    input.requestId ?? null,
    ctx.now(),
    input.borrowerId ?? null,
  );
  return {
    userId: input.userId,
    title: input.title,
    body: input.body,
    tag: input.tag ?? `${input.type}:${input.requestId ?? input.itemId ?? ""}`,
  };
}

export type PendingPush = { userId: string; title: string; body: string; tag: string };

/**
 * Sends web push for recorded notes. Skipped silently unless VAPID keys are configured
 * and the person has subscribed. A gone subscription (404/410) is removed.
 */
export async function flush(ctx: Ctx, pending: PendingPush[]): Promise<void> {
  if (!ctx.config.vapid) return;
  for (const note of pending) {
    const subs = all<PushSubscription & { user_id: string }>(
      ctx.db,
      "SELECT endpoint, p256dh, auth, user_id FROM push_subscriptions WHERE user_id = ?",
      note.userId,
    );
    for (const sub of subs) {
      try {
        await ctx.push.send(
          { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
          { title: note.title, body: note.body, url: "/#/alerts", tag: note.tag },
        );
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) run(ctx.db, "DELETE FROM push_subscriptions WHERE endpoint = ?", sub.endpoint);
        else console.error("push failed", status ?? (error instanceof Error ? error.name : "unknown"));
      }
    }
  }
}

export function unreadCount(ctx: Ctx, userId: string): number {
  return get<{ n: number }>(ctx.db, "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL", userId)?.n ?? 0;
}
