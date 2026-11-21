import { randomUUID } from "node:crypto";
import type { MaybePromise } from "./auth.ts";

export const CHAT_TEXT_MAX = 1000;
export const CHAT_THREAD_LIMIT = 200;
export const CHAT_PUSH_WINDOW_MS = 15_000;
export const CHAT_PUSH_GAP_MS = 60_000;

const PREVIEW_MAX = 140;
const LAST_SENT_MAX = 10_000;

export type ChatMessage = { id: string; chatId: string; userId: string; userName: string; body: string; createdAt: number };

/** The app implements this over its own tables. It checks the user may see and post in `chatId` before calling the kit. */
export type ChatStore = {
  /** The newest `limit` messages of the chat, returned oldest first. */
  listMessages(chatId: string, limit: number): MaybePromise<ChatMessage[]>;
  insertMessage(message: { id: string; chatId: string; userId: string; body: string; createdAt: number }): MaybePromise<void>;
  /** Upsert chat_reads(user, chat) = at. */
  setReadAt(userId: string, chatId: string, at: number): MaybePromise<void>;
  /** Per chat id: messages by other users with createdAt > the user's read_at (0 when none). Every requested id is present (0 if none). */
  unreadCounts(userId: string, chatIds: string[]): MaybePromise<Record<string, number>>;
  setMuted(userId: string, chatId: string, muted: boolean): MaybePromise<void>;
  isMuted(userId: string, chatId: string): MaybePromise<boolean>;
};

export type ChatOptions = {
  store: ChatStore;
  now?: () => number;
  /** Default randomUUID. */
  newId?: () => string;
  /** Default 200. */
  threadLimit?: number;
  /** Default 1000, counted in code points. */
  maxLength?: number;
};

export type CleanChatText = { ok: true; text: string } | { ok: false; reason: "empty" | "too_long" };

export type Chat = {
  /** Last threadLimit messages oldest first, plus whether `userId` muted it. Does not mark read. */
  thread(chatId: string, userId: string): Promise<{ messages: ChatMessage[]; muted: boolean }>;
  /** Cleans text (cleanChatText), inserts, returns the message. */
  post(
    chatId: string,
    user: { id: string; name: string },
    text: unknown,
  ): Promise<{ ok: true; message: ChatMessage } | { ok: false; reason: "empty" | "too_long" }>;
  /** Marks the chat read for the user, at now(). */
  markRead(chatId: string, userId: string): Promise<void>;
  /** An empty list answers {} without calling the store. Duplicate ids are asked once. */
  unreadCounts(userId: string, chatIds: string[]): Promise<Record<string, number>>;
  setMuted(chatId: string, userId: string, muted: boolean): Promise<void>;
};

/**
 * Trims and checks a message. Control characters other than tab, newline and
 * carriage return are dropped, CRLF becomes LF, and the length is counted in
 * code points. A non-string is empty.
 */
export function cleanChatText(raw: unknown, max: number = CHAT_TEXT_MAX): CleanChatText {
  if (typeof raw !== "string") return { ok: false, reason: "empty" };
  const text = raw
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/\r\n/g, "\n")
    .trim();
  if (text === "") return { ok: false, reason: "empty" };
  if ([...text].length > max) return { ok: false, reason: "too_long" };
  return { ok: true, text };
}

function positiveInt(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new TypeError(`createChat: ${name} must be a positive integer`);
  }
  return value;
}

export function createChat(options: ChatOptions): Chat {
  if (!options || typeof options !== "object") throw new TypeError("createChat: options are required");
  const { store } = options;
  if (!store || typeof store !== "object") throw new TypeError("createChat: store is required");
  const now = options.now ?? Date.now;
  const newId = options.newId ?? randomUUID;
  const threadLimit = options.threadLimit === undefined ? CHAT_THREAD_LIMIT : positiveInt(options.threadLimit, "threadLimit");
  const maxLength = options.maxLength === undefined ? CHAT_TEXT_MAX : positiveInt(options.maxLength, "maxLength");

  return {
    async thread(chatId, userId) {
      const messages = await store.listMessages(chatId, threadLimit);
      const muted = await store.isMuted(userId, chatId);
      return { messages, muted };
    },

    async post(chatId, user, text) {
      const cleaned = cleanChatText(text, maxLength);
      if (!cleaned.ok) return cleaned;
      const message: ChatMessage = {
        id: newId(),
        chatId,
        userId: user.id,
        userName: user.name,
        body: cleaned.text,
        createdAt: now(),
      };
      await store.insertMessage({ id: message.id, chatId, userId: user.id, body: message.body, createdAt: message.createdAt });
      return { ok: true, message };
    },

    async markRead(chatId, userId) {
      await store.setReadAt(userId, chatId, now());
    },

    async unreadCounts(userId, chatIds) {
      const ids = [...new Set(chatIds)];
      if (ids.length === 0) return {};
      return await store.unreadCounts(userId, ids);
    },

    async setMuted(chatId, userId, muted) {
      await store.setMuted(userId, chatId, muted);
    },
  };
}

/**
 * A suggested SQLite layout. Apply it if it fits, or map your own tables in a
 * ChatStore. The kit never runs it. Per-method SQL: docs/chat.md.
 */
export const CHAT_SQLITE_SCHEMA = `
-- One row per chat. Add your own owner column, e.g.
-- group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE.
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

-- user_id has no foreign key here. If you have a users table, add
-- REFERENCES users(id) ON DELETE CASCADE to user_id in the three tables below.
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat ON chat_messages(chat_id, created_at);

CREATE TABLE IF NOT EXISTS chat_reads (
  user_id TEXT NOT NULL,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  read_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, chat_id)
);

CREATE TABLE IF NOT EXISTS chat_mutes (
  user_id TEXT NOT NULL,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, chat_id)
);
`;

// ---------- batched push ----------

/**
 * How long to wait before a push for a recipient: the window when nothing was
 * sent lately, else whatever is left of the gap since the last push (never
 * less than the window). 0 or less for lastSentAt means never sent.
 */
export function nextChatPushDelay(
  lastSentAt: number,
  now: number,
  windowMs: number = CHAT_PUSH_WINDOW_MS,
  gapMs: number = CHAT_PUSH_GAP_MS,
): number {
  if (lastSentAt <= 0) return windowMs;
  const since = now - lastSentAt;
  if (since >= gapMs) return windowMs;
  return Math.max(windowMs, gapMs - since);
}

export type ChatPush = {
  chatId: string;
  userId: string;
  count: number;
  firstBody: string;
  /** count <= 1 ? firstBody : `${count} new messages`, unless `format` is set. */
  body: string;
};

export type ChatPushBatcherOptions = {
  /** The app sends the web push. The kit has no web-push dependency. */
  send(push: ChatPush): MaybePromise<void>;
  /** Checked at fire time. False drops the slot (left the group, muted since). Default: always true. */
  stillEligible?(chatId: string, userId: string): MaybePromise<boolean>;
  format?(count: number, firstBody: string): string;
  windowMs?: number;
  gapMs?: number;
  now?: () => number;
  /** Default setTimeout (unref'd). */
  setTimer?(fn: () => void, ms: number): unknown;
  /** Default clearTimeout. */
  clearTimer?(handle: unknown): void;
  /** Default console.error. Send errors are caught and logged here, never thrown from a timer. */
  log?(message: string): void;
};

export type ChatPushBatcher = {
  /** One message posted: queue a notice for each recipient (the app passes members minus sender minus muted). `body` is the preview, cut to 140 characters. */
  schedule(input: { chatId: string; recipients: string[]; body: string }): void;
  /** Fires the slots that are due now. `force` fires every slot whatever its window (use on shutdown). */
  flush(force?: boolean): Promise<void>;
  /** The number of open slots. */
  pending(): number;
  /** Clears all timers and drops all slots. */
  dispose(): void;
};

type Slot = {
  chatId: string;
  userId: string;
  firstBody: string;
  count: number;
  dueAt: number;
  busy: boolean;
  timer: unknown;
};

export function createChatPushBatcher(options: ChatPushBatcherOptions): ChatPushBatcher {
  if (!options || typeof options !== "object") throw new TypeError("createChatPushBatcher: options are required");
  if (typeof options.send !== "function") throw new TypeError("createChatPushBatcher: send is required");
  const { send, stillEligible, format } = options;
  const windowMs = options.windowMs ?? CHAT_PUSH_WINDOW_MS;
  const gapMs = options.gapMs ?? CHAT_PUSH_GAP_MS;
  const now = options.now ?? Date.now;
  const setTimer =
    options.setTimer ??
    ((fn: () => void, ms: number): unknown => {
      const handle = setTimeout(fn, ms);
      handle.unref?.();
      return handle;
    });
  const clearTimer = options.clearTimer ?? ((handle: unknown): void => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const log = options.log ?? ((message: string) => console.error(message));

  // One slot per recipient and chat. The gap is per recipient and chat too.
  const slots = new Map<string, Slot>();
  const lastSent = new Map<string, number>();
  const keyOf = (chatId: string, userId: string): string => JSON.stringify([chatId, userId]);

  function logFailure(error: unknown): void {
    const name = error instanceof Error && typeof error.name === "string" ? error.name : "UnknownError";
    try {
      log(`chat: push failed (${name})`);
    } catch {
      // A broken log must not become an unhandled rejection.
    }
  }

  function arm(key: string, slot: Slot, delay: number): void {
    slot.timer = setTimer(() => {
      void fire(key, false).catch(logFailure);
    }, delay);
  }

  async function fire(key: string, force: boolean): Promise<void> {
    const slot = slots.get(key);
    if (!slot || slot.busy) return;
    clearTimer(slot.timer);
    const wait = slot.dueAt - now();
    if (!force && wait > 0) {
      arm(key, slot, wait);
      return;
    }
    slot.busy = true;
    try {
      if (stillEligible && !(await stillEligible(slot.chatId, slot.userId))) {
        if (slots.get(key) === slot) slots.delete(key);
        return;
      }
      // dispose() ran while eligibility was checked.
      if (slots.get(key) !== slot) return;
      // Messages that came in while eligibility was checked are in the count. Later ones open a new slot.
      const { chatId, userId, count, firstBody } = slot;
      slots.delete(key);
      lastSent.set(key, now());
      if (lastSent.size > LAST_SENT_MAX) {
        for (const [oldKey, at] of lastSent) if (now() - at >= gapMs) lastSent.delete(oldKey);
      }
      const body = format ? format(count, firstBody) : count <= 1 ? firstBody : `${count} new messages`;
      await send({ chatId, userId, count, firstBody, body });
    } catch (error) {
      // A new slot for the same key may be open by now. Only drop this one.
      if (slots.get(key) === slot) slots.delete(key);
      logFailure(error);
    } finally {
      slot.busy = false;
    }
  }

  return {
    schedule({ chatId, recipients, body }) {
      const preview = [...body].slice(0, PREVIEW_MAX).join("");
      const at = now();
      for (const userId of new Set(recipients)) {
        const key = keyOf(chatId, userId);
        const open = slots.get(key);
        if (open) {
          open.count += 1;
          continue;
        }
        const delay = nextChatPushDelay(lastSent.get(key) ?? 0, at, windowMs, gapMs);
        const slot: Slot = { chatId, userId, firstBody: preview, count: 1, dueAt: at + delay, busy: false, timer: undefined };
        slots.set(key, slot);
        arm(key, slot, delay);
      }
    },

    async flush(force = false) {
      for (const key of [...slots.keys()]) await fire(key, force);
    },

    pending: () => slots.size,

    dispose() {
      for (const slot of slots.values()) clearTimer(slot.timer);
      slots.clear();
    },
  };
}
