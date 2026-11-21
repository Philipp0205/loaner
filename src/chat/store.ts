import type { DatabaseSync } from "node:sqlite";
import type { ChatMessage, ChatStore } from "../app-kit/index.ts";
import { all, get, run } from "../db.js";

type MessageRow = { id: string; chatId: string; userId: string; userName: string; body: string; createdAt: number };

/** The kit's ChatStore over node:sqlite. A chat id is a group id. The caller has already checked membership. */
export function sqliteChatStore(db: DatabaseSync): ChatStore {
  return {
    // The newest `limit` rows, then oldest first.
    listMessages(chatId, limit): ChatMessage[] {
      const rows = all<MessageRow>(
        db,
        `SELECT id, chat_id AS chatId, user_id AS userId, userName, body, created_at AS createdAt
         FROM (
           SELECT m.id, m.chat_id, m.user_id, u.name AS userName, m.body, m.created_at
           FROM chat_messages m JOIN users u ON u.id = m.user_id
           WHERE m.chat_id = ?
           ORDER BY m.created_at DESC, m.id DESC
           LIMIT ?
         )
         ORDER BY created_at ASC, id ASC`,
        chatId,
        limit,
      );
      return rows.map((row) => ({ ...row }));
    },

    insertMessage(message) {
      run(
        db,
        "INSERT INTO chat_messages (id, chat_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)",
        message.id, message.chatId, message.userId, message.body, message.createdAt,
      );
    },

    setReadAt(userId, chatId, at) {
      run(
        db,
        `INSERT INTO chat_reads (user_id, chat_id, read_at) VALUES (?, ?, ?)
         ON CONFLICT (user_id, chat_id) DO UPDATE SET read_at = excluded.read_at`,
        userId, chatId, at,
      );
    },

    // Messages by other people newer than my read time. Every asked id is in the answer.
    unreadCounts(userId, chatIds) {
      const counts: Record<string, number> = Object.fromEntries(chatIds.map((id) => [id, 0]));
      const marks = chatIds.map(() => "?").join(", ");
      const rows = all<{ chatId: string; n: number }>(
        db,
        `SELECT m.chat_id AS chatId, COUNT(*) AS n
         FROM chat_messages m
         LEFT JOIN chat_reads r ON r.chat_id = m.chat_id AND r.user_id = ?
         WHERE m.chat_id IN (${marks}) AND m.user_id <> ? AND m.created_at > COALESCE(r.read_at, 0)
         GROUP BY m.chat_id`,
        userId, ...chatIds, userId,
      );
      for (const row of rows) counts[row.chatId] = Number(row.n);
      return counts;
    },

    setMuted(userId, chatId, muted) {
      if (muted) run(db, "INSERT OR IGNORE INTO chat_mutes (user_id, chat_id) VALUES (?, ?)", userId, chatId);
      else run(db, "DELETE FROM chat_mutes WHERE user_id = ? AND chat_id = ?", userId, chatId);
    },

    isMuted(userId, chatId) {
      return !!get(db, "SELECT 1 AS x FROM chat_mutes WHERE user_id = ? AND chat_id = ?", userId, chatId);
    },
  };
}
