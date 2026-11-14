import { api } from "./api.js";
import { go, redraw, state } from "./state.js";
import { emptyState, fmtMoment, h } from "./util.js";

export async function renderAlerts() {
  const data = await api("GET", "/api/notifications");
  const unread = data.notifications.filter((n) => !n.read).length;
  const mark = h("button", { type: "button", id: "mark-read", onclick: async () => {
    await api("POST", "/api/notifications/read");
    state.unread = 0;
    redraw("#/alerts");
  } }, "Mark all as read");
  const head = h("div", { class: "row", style: "justify-content:space-between;margin-bottom:12px" }, h("h1", { style: "margin:0" }, "Alerts"), unread ? mark : null);
  if (!data.notifications.length) {
    state.unread = 0;
    return h("div", null, head, emptyState("All quiet", "You will see requests, answers and reminders here."));
  }
  state.unread = data.unread;
  const cards = data.notifications.map((n) =>
    h("article", { class: `card${n.read ? "" : " unread"}`, "data-note": n.type },
      h("div", { class: "row" }, h("h3", { class: "grow" }, n.title), h("span", { class: "muted small" }, fmtMoment(n.createdAt))),
      h("p", { style: "margin:6px 0 0" }, n.body),
      n.requestId || n.itemId ? h("div", { class: "row", style: "margin-top:6px" }, h("button", { type: "button", class: "link", onclick: () => open(n) }, n.type === "request_new" ? "Review request" : "Open")) : null,
    ),
  );
  return h("div", null, head, cards);
}

async function open(n) {
  if (n.type === "request_new" || n.type === "request_cancelled" || n.type === "late") {
    go("#/requests");
  } else if (n.type === "item_removed") {
    go("#/requests");
  } else if (n.itemId) {
    go(`#/item/${n.itemId}`);
  } else go("#/requests");
}
