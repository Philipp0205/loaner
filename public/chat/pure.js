import { CHAT_COPY } from "./copy.js";

/** Fired on document when the unread counts changed locally, so app.js repaints the bar and the bell. */
export const UNREAD_EVENT = "loaner:unread";

/** The hash of a group's chat screen. */
export const chatHash = (groupId) => `#/group/${groupId}/chat`;

/** The Chat tab badge: every unread group message across my groups. */
export function totalUnread(chats) {
  return (chats || []).reduce((sum, chat) => sum + (Number(chat.unreadChat) || 0), 0);
}

/** The row's second line: "Ann: text", "You: text", or a short empty line when nobody has written yet. */
export function previewLine(last, meId) {
  if (!last || !last.text) return CHAT_COPY.listEmpty;
  return `${last.userId === meId ? CHAT_COPY.you : last.author}: ${last.text}`;
}

/** A change signature for a chat list, so a poll can tell whether the Chat tab needs a redraw. */
export const chatSignature = (chats) => JSON.stringify((chats || []).map((chat) => [chat.id, chat.unreadChat, chat.last ? chat.last.at : 0, chat.name]));
