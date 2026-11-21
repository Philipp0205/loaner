/** Every string the Alerts screen and the header bell show. */
export const ALERTS_COPY = {
  title: "Alerts",
  bell: "Alerts",
  back: "Back",
  markRead: "Mark all as read",
  emptyTitle: "All quiet",
  emptyText: "You will see requests, answers, new items and reminders here.",
  reviewRequest: "Review request",
  open: "Open",
};

/** The bell's name for assistive tech, with the unread count when there is one. */
export const bellLabel = (count) => (count > 0 ? `${ALERTS_COPY.bell}, ${count} unread` : ALERTS_COPY.bell);
