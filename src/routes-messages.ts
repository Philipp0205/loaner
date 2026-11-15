import { requireVisibleItem, type ItemRow } from "./access.js";
import { newId } from "./code.js";
import { all, get, run, tx } from "./db.js";
import { addNote, flush, type PendingPush } from "./notify.js";
import { HttpError, Reply, jsonBody, me, type Ctx, type Route, type User } from "./types.js";
import { requiredLongText } from "./validate.js";

export const MESSAGE_MAX = 1000;
/** A thread view shows at most this many of the newest messages. */
const THREAD_LIMIT = 200;

type MessageRow = { id: string; sender_id: string; body: string; created_at: number };

/**
 * True when the other person has sent something in this (item, borrower) thread that `userId` has not opened yet.
 * Messages you sent yourself never count.
 */
export function threadUnread(ctx: Ctx, itemId: string, borrowerId: string, userId: string): boolean {
  const row = get<{ n: number }>(
    ctx.db,
    `SELECT EXISTS (
       SELECT 1 FROM messages m
       WHERE m.item_id = ? AND m.borrower_id = ? AND m.sender_id <> ?
         AND m.created_at > COALESCE((SELECT r.last_read_at FROM message_reads r WHERE r.item_id = m.item_id AND r.borrower_id = m.borrower_id AND r.user_id = ?), 0)
     ) AS n`,
    itemId, borrowerId, userId, userId,
  );
  return !!row?.n;
}

function markRead(ctx: Ctx, itemId: string, borrowerId: string, userId: string, upTo: number): void {
  run(
    ctx.db,
    `INSERT INTO message_reads (item_id, borrower_id, user_id, last_read_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(item_id, borrower_id, user_id) DO UPDATE SET last_read_at = MAX(last_read_at, excluded.last_read_at)`,
    itemId, borrowerId, userId, upTo,
  );
}

type Thread = { item: ItemRow; borrower: User };

/**
 * The thread this caller is allowed to use, or a 404. The borrower's thread is always (item, caller).
 * The owner names the borrower with ?borrower=. Everyone else learns nothing.
 */
function requireThread(ctx: Ctx, user: User, itemId: string, asked: string | null): Thread {
  const item = requireVisibleItem(ctx, user.id, itemId);
  const notFound = () => new HttpError(404, "thread not found");
  if (item.owner_id !== user.id) {
    if (asked !== null && asked !== user.id) throw notFound();
    return { item, borrower: user };
  }
  if (!asked) throw new HttpError(400, "borrower is required");
  if (asked === user.id) throw notFound();
  const borrower = get<User>(ctx.db, "SELECT id, name FROM users WHERE id = ?", asked);
  if (!borrower) throw notFound();
  // The owner can only open a thread with someone who could see the item, or who already wrote or asked.
  const known = get(
    ctx.db,
    `SELECT 1 AS x WHERE EXISTS (SELECT 1 FROM messages WHERE item_id = ? AND borrower_id = ?)
        OR EXISTS (SELECT 1 FROM requests WHERE item_id = ? AND borrower_id = ?)
        OR EXISTS (SELECT 1 FROM item_groups ig JOIN memberships m ON m.group_id = ig.group_id WHERE ig.item_id = ? AND m.user_id = ?)`,
    item.id, borrower.id, item.id, borrower.id, item.id, borrower.id,
  );
  if (!known) throw notFound();
  return { item, borrower };
}

function messageView(row: MessageRow) {
  return { id: row.id, senderId: row.sender_id, body: row.body, createdAt: row.created_at };
}

export function messageRoutes(): Route[] {
  return [
    {
      method: "GET",
      path: "/api/items/:id/messages",
      handler(req) {
        const user = me(req);
        const { item, borrower } = requireThread(req.ctx, user, req.params.id, req.query.get("borrower"));
        const rows = all<MessageRow>(
          req.ctx.db,
          `SELECT id, sender_id, body, created_at FROM (
             SELECT id, sender_id, body, created_at FROM messages WHERE item_id = ? AND borrower_id = ?
             ORDER BY created_at DESC, id DESC LIMIT ${THREAD_LIMIT}
           ) ORDER BY created_at, id`,
          item.id, borrower.id,
        );
        tx(req.ctx.db, () => {
          if (rows.length) markRead(req.ctx, item.id, borrower.id, user.id, rows[rows.length - 1].created_at);
          // The alerts about this thread are answered by opening it.
          run(
            req.ctx.db,
            "UPDATE notifications SET read_at = ? WHERE user_id = ? AND type = 'message' AND item_id = ? AND borrower_id = ? AND read_at IS NULL",
            req.ctx.now(), user.id, item.id, borrower.id,
          );
        });
        return {
          thread: {
            item: { id: item.id, name: item.name },
            owner: { id: item.owner_id, name: item.owner_name },
            borrower: { id: borrower.id, name: borrower.name },
            messages: rows.map(messageView),
          },
        };
      },
    },
    {
      method: "POST",
      path: "/api/items/:id/messages",
      async handler(req) {
        const user = me(req);
        const { item, borrower } = requireThread(req.ctx, user, req.params.id, req.query.get("borrower"));
        const body = requiredLongText(jsonBody(req).body, "message", MESSAGE_MAX);
        const toId = user.id === borrower.id ? item.owner_id : borrower.id;
        const id = newId();
        const pending: PendingPush[] = [];
        let row: MessageRow | undefined;
        tx(req.ctx.db, () => {
          // Strictly increasing within a thread, so "newer than last read" is exact even inside one millisecond.
          const last = get<{ at: number | null }>(req.ctx.db, "SELECT MAX(created_at) AS at FROM messages WHERE item_id = ? AND borrower_id = ?", item.id, borrower.id)?.at ?? 0;
          const at = Math.max(req.ctx.now(), Number(last) + 1);
          run(
            req.ctx.db,
            "INSERT INTO messages (id, item_id, borrower_id, sender_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            id, item.id, borrower.id, user.id, body, at,
          );
          row = { id, sender_id: user.id, body, created_at: at };
          pending.push(
            addNote(req.ctx, {
              userId: toId, type: "message", itemId: item.id, borrowerId: borrower.id,
              title: "New message",
              body: `${user.name} sent you a message about ${item.name}.`,
              tag: `message:${item.id}:${borrower.id}`,
            }),
          );
        });
        await flush(req.ctx, pending);
        return new Reply(201, { message: messageView(row as MessageRow) });
      },
    },
  ];
}
