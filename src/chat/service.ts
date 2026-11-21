import { createChat, createChatPushBatcher, type Chat, type ChatPush, type ChatPushBatcher } from "../app-kit/index.ts";
import { isMember } from "../access.js";
import { all, get, run } from "../db.js";
import { flush as sendPending } from "../notify.js";
import type { Ctx } from "../types.js";
import { sqliteChatStore } from "./store.js";

/** The group chat, as the routes and the server use it. A chat id is the group id. */
export type GroupChat = {
  /** The kit service. Callers check membership first. */
  chat: Chat;
  /** Creates the chat row for a group the first time it is needed. */
  ensure(groupId: string): void;
  /** Unread messages per group id for one person. */
  unreadCounts(userId: string, groupIds: string[]): Promise<Record<string, number>>;
  /** After a post: queue one push per member who is not the sender and has not muted the chat. */
  schedulePush(groupId: string, senderId: string): void;
  /** Fires the due pushes (everything with force). Tests call this instead of waiting out the window. */
  flush(force?: boolean): Promise<void>;
  /** Shutdown: sends what is queued, then stops the timers. Call it before closing the database. */
  close(): Promise<void>;
  /** Stops the timers and drops what is queued. */
  dispose(): void;
  /** Open push slots. */
  pending(): number;
};

export type GroupChatOptions = { windowMs?: number; gapMs?: number };

/** The only push text. The message itself never leaves the server in a notification. */
export function pushLine(count: number): string {
  return count <= 1 ? "New message" : `${count} new messages`;
}

export function createGroupChat(ctx: Ctx, options: GroupChatOptions = {}): GroupChat {
  // Every reading is later than the one before, so a message and a mark-read never share a millisecond.
  let last = 0;
  const now = () => (last = Math.max(ctx.now(), last + 1));
  const chat = createChat({ store: sqliteChatStore(ctx.db), now });
  const ensure = (groupId: string): void => {
    run(ctx.db, "INSERT OR IGNORE INTO chats (id, created_at, group_id) VALUES (?, ?, ?)", groupId, ctx.now(), groupId);
  };

  const batcher: ChatPushBatcher = createChatPushBatcher({
    send: (push) => deliver(ctx, push),
    stillEligible: (chatId, userId) => isMember(ctx, userId, chatId) && !muted(ctx, userId, chatId),
    format: (count) => pushLine(count),
    windowMs: options.windowMs,
    gapMs: options.gapMs,
  });

  return {
    chat,
    ensure,
    async unreadCounts(userId, groupIds) {
      groupIds.forEach(ensure);
      return await chat.unreadCounts(userId, groupIds);
    },
    schedulePush(groupId, senderId) {
      const recipients = all<{ user_id: string }>(
        ctx.db,
        `SELECT m.user_id FROM memberships m
         WHERE m.group_id = ? AND m.user_id <> ?
           AND NOT EXISTS (SELECT 1 FROM chat_mutes c WHERE c.chat_id = m.group_id AND c.user_id = m.user_id)`,
        groupId, senderId,
      ).map((row) => row.user_id);
      // The body is empty on purpose: the batcher keeps it as a preview, and nothing here may carry the text.
      if (recipients.length) batcher.schedule({ chatId: groupId, recipients, body: "" });
    },
    flush: (force = false) => batcher.flush(force),
    async close() {
      await batcher.flush(true);
      batcher.dispose();
    },
    dispose: () => batcher.dispose(),
    pending: () => batcher.pending(),
  };
}

function muted(ctx: Ctx, userId: string, chatId: string): boolean {
  return !!get(ctx.db, "SELECT 1 AS x FROM chat_mutes WHERE user_id = ? AND chat_id = ?", userId, chatId);
}

/** Sends one batched notice. The title is the group name and the line is generic, so no message text goes out. */
async function deliver(ctx: Ctx, push: ChatPush): Promise<void> {
  const group = get<{ name: string }>(ctx.db, "SELECT name FROM groups WHERE id = ?", push.chatId);
  if (!group) return;
  await sendPending(ctx, [
    { userId: push.userId, title: group.name, body: push.body, url: `/#/group/${push.chatId}/chat`, tag: `chat:${push.chatId}` },
  ]);
}
