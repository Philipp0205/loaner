import { api } from "./api.js";
import { ALERTS_COPY } from "./alerts/copy.js";
import { closeAlerts } from "./alerts/return.js";
import { icon } from "./icons.js";
import { threadHash } from "./messages.js";
import { go, redraw, state } from "./state.js";
import { emptyState, fmtMoment, h } from "./util.js";

/** The header of the Alerts screen: a back control, the title, and "Mark all as read" while something is unread. */
function alertsHead(mark) {
  return h("div", { class: "thread-head" },
    h("button", { class: "icon-btn", type: "button", id: "alerts-back", "aria-label": ALERTS_COPY.back, onclick: () => closeAlerts(go) }, icon("back")),
    h("div", { class: "grow" }, h("h1", null, ALERTS_COPY.title)),
    mark);
}

/** Alerts is a pushed screen (#/alerts), opened from the bell in the header of a main tab. */
export async function renderAlerts() {
  const data = await api("GET", "/api/notifications");
  const unread = data.notifications.filter((n) => !n.read).length;
  const mark = h("button", { type: "button", id: "mark-read", onclick: async () => {
    await api("POST", "/api/notifications/read");
    state.unread = 0;
    redraw("#/alerts");
  } }, ALERTS_COPY.markRead);
  const head = alertsHead(unread ? mark : null);
  if (!data.notifications.length) {
    state.unread = 0;
    return h("div", null, head, emptyState(ALERTS_COPY.emptyTitle, ALERTS_COPY.emptyText));
  }
  state.unread = data.unread;
  const cards = data.notifications.map((n) =>
    h("article", { class: `card${n.read ? "" : " unread"}`, "data-note": n.type },
      h("div", { class: "card-top" }, h("h3", null, n.title), h("span", { class: "muted small" }, fmtMoment(n.createdAt))),
      h("p", { style: "margin:6px 0 0" }, n.body),
      n.requestId || n.itemId ? h("div", { style: "margin-top:6px" }, h("button", { type: "button", class: "link", onclick: () => open(n) }, n.type === "request_new" ? ALERTS_COPY.reviewRequest : ALERTS_COPY.open)) : null,
    ),
  );
  return h("div", null, head, cards);
}

async function open(n) {
  if (n.type === "message" && n.itemId) {
    // The borrower's own thread has no borrower id in the route. The owner's names the borrower.
    go(threadHash(n.itemId, n.borrowerId && n.borrowerId !== state.user.id ? n.borrowerId : null));
  } else if (n.type === "request_new" || n.type === "request_cancelled" || n.type === "late") {
    go("#/requests");
  } else if (n.type === "item_removed") {
    go("#/requests");
  } else if (n.itemId) {
    go(`#/item/${n.itemId}`);
  } else go("#/requests");
}
