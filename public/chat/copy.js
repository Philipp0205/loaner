/** Every string the group chat shows. */
export const CHAT_COPY = {
  title: "Group chat",
  back: "Back",
  placeholder: "Message the group",
  send: "Send",
  sending: "Sending...",
  failed: "Not sent. Tap to retry.",
  empty: "No messages yet. Say hello.",
  mute: "Mute",
  unmute: "Unmute",
  muteHint: "Mute this chat. You will not get notifications for it.",
  unmuteHint: "Unmute this chat to get notifications again.",
  nowMuted: "Group chat muted",
  nowUnmuted: "Group chat unmuted",
  // The Chat tab: the list of group chats.
  listTitle: "Chat",
  listEmpty: "No messages yet",
  listEmptyTitle: "No group chats yet",
  listEmptyText: "Create or join a group and its chat shows up here.",
  you: "You",
};

/** The label of an unread badge, for assistive tech. */
export function unreadLabel(count) {
  return count === 1 ? "1 unread message" : `${count} unread messages`;
}

/** The number in the badge. Long counts are cut so the badge stays small. */
export function badgeText(count) {
  return count > 99 ? "99+" : String(count);
}
