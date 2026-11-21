import { all } from "../db.js";
import type { Ctx } from "../types.js";
import type { GroupChat } from "./service.js";

/** The newest message of a group chat, cut short for a list row. */
export type LastMessage = { userId: string; author: string; text: string; at: number };

/** One row of the Chat tab: a group the person is in, its newest message, and what they have not read. */
export type ChatRow = { id: string; name: string; unreadChat: number; last: LastMessage | null };

const PREVIEW_MAX = 120;

/** One line of text: whitespace collapsed, long text cut with three dots. Only the preview, never a push. */
export function previewText(body: string): string {
  const line = body.replace(/\s+/g, " ").trim();
  return line.length > PREVIEW_MAX ? `${line.slice(0, PREVIEW_MAX - 3).trimEnd()}...` : line;
}

/** Most recent message first. Groups with no messages come last, by name. */
export function sortChats(rows: ChatRow[]): ChatRow[] {
  return [...rows].sort((a, b) => {
    if (a.last && b.last) return b.last.at - a.last.at || a.name.localeCompare(b.name);
    if (a.last || b.last) return a.last ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

/** The newest message per chat id, with the author's name. */
function lastMessages(ctx: Ctx, chatIds: string[]): Map<string, LastMessage> {
  const found = new Map<string, LastMessage>();
  if (!chatIds.length) return found;
  const marks = chatIds.map(() => "?").join(", ");
  const rows = all<{ chatId: string; userId: string; author: string; body: string; at: number }>(
    ctx.db,
    `SELECT m.chat_id AS chatId, m.user_id AS userId, u.name AS author, m.body, m.created_at AS at
     FROM chat_messages m JOIN users u ON u.id = m.user_id
     WHERE m.chat_id IN (${marks})
       AND m.id = (SELECT n.id FROM chat_messages n WHERE n.chat_id = m.chat_id ORDER BY n.created_at DESC, n.id DESC LIMIT 1)`,
    ...chatIds,
  );
  for (const row of rows) found.set(row.chatId, { userId: row.userId, author: row.author, text: previewText(row.body), at: Number(row.at) });
  return found;
}

/** The Chat tab list for one person. Only groups they are a member of are asked about, so nothing else can leak. */
export async function chatList(ctx: Ctx, groupChat: GroupChat, userId: string): Promise<ChatRow[]> {
  const groups = all<{ id: string; name: string }>(
    ctx.db,
    "SELECT g.id, g.name FROM groups g JOIN memberships m ON m.group_id = g.id WHERE m.user_id = ? ORDER BY m.rowid",
    userId,
  );
  const ids = groups.map((group) => group.id);
  const unread = await groupChat.unreadCounts(userId, ids);
  const last = lastMessages(ctx, ids);
  return sortChats(groups.map((group) => ({ id: group.id, name: group.name, unreadChat: unread[group.id] ?? 0, last: last.get(group.id) ?? null })));
}
