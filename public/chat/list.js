import { api } from "../api.js";
import { tabHead } from "../alerts/bell.js";
import { go, state } from "../state.js";
import { emptyState, h } from "../util.js";
import { CHAT_COPY, badgeText, unreadLabel } from "./copy.js";
import { chatHash, previewLine, totalUnread } from "./pure.js";

/** One group chat row: name, last message line, and an unread badge. A tap opens that group's chat. */
function chatRow(chat) {
  const unread = Number(chat.unreadChat) || 0;
  const badge = unread > 0 ? h("span", { class: "ak-badge row-badge", "data-chat-unread": unread, role: "img", "aria-label": unreadLabel(unread) }, badgeText(unread)) : null;
  return h("button", { type: "button", class: `chat-row${unread > 0 ? " unread" : ""}`, "data-chat-open": chat.id, onclick: () => go(chatHash(chat.id)) },
    h("span", { class: "avatar", "aria-hidden": "true" }, (chat.name || "?").slice(0, 1).toUpperCase()),
    h("span", { class: "chat-row-copy" },
      h("strong", { class: "chat-row-name" }, chat.name),
      h("span", { class: `chat-row-preview${chat.last ? "" : " muted"}` }, previewLine(chat.last, state.user.id))),
    badge);
}

/** The Chat tab (#/chat): every group the person is in, even if it is only one. Newest message first. */
export async function renderChatList() {
  const { chats } = await api("GET", "/api/chats");
  state.chats = chats;
  state.chatUnread = totalUnread(chats);
  const head = tabHead(CHAT_COPY.listTitle);
  if (!chats.length) return h("div", null, head, emptyState(CHAT_COPY.listEmptyTitle, CHAT_COPY.listEmptyText));
  return h("div", null, head, h("div", { class: "chat-list" }, chats.map(chatRow)));
}
