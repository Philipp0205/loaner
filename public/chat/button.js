import { go } from "../state.js";
import { h } from "../util.js";
import { CHAT_COPY, badgeText, unreadLabel } from "./copy.js";

/** The hash of a group's chat screen. */
export const chatHash = (groupId) => `#/group/${groupId}/chat`;

/** The "Group chat" button on a group card, with a count badge while there are unread messages. */
export function chatButton(group) {
  const unread = Number(group.unreadChat) || 0;
  return h("button", { type: "button", class: "block group-chat-open", "data-chat-open": group.id, onclick: () => go(chatHash(group.id)) },
    CHAT_COPY.open,
    unread > 0 ? h("span", { class: "chat-badge", "data-chat-unread": unread, role: "img", "aria-label": unreadLabel(unread) }, badgeText(unread)) : null,
  );
}
