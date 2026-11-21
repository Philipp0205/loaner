/** The bottom tabs, left to right. Alerts is not one: it opens from the bell in the header. */
export const TABS = [
  ["browse", "Browse"],
  ["mine", "My items"],
  ["requests", "Requests"],
  ["chat", "Chat"],
  ["you", "You"],
];

/** The badges on the bar: only Chat has one, the unread group messages. Alerts live on the header bell. */
export const tabBadges = (chatUnread) => ({ chat: chatUnread > 0 ? chatUnread : 0 });
