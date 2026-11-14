import { api } from "./api.js";
import { go, state } from "./state.js";
import { busy, emptyState, fmtRange, h, toast } from "./util.js";

const LABEL = { pending: "Waiting", approved: "Approved", declined: "Declined", cancelled: "Cancelled", lent: "Lent out", returned: "Returned" };

/**
 * One request. role is "owner" (sees Approve/Decline/Handed over/Returned) or "borrower" (sees Cancel).
 * `after` runs once an action has succeeded, to redraw.
 */
export function requestCard(r, role, after) {
  const who = role === "owner" ? `${r.borrower.name} wants ${r.item.name}` : `${r.item.name} from ${r.owner.name}`;
  const late = r.status === "lent" && r.until < state.today;
  const reply = h("input", { type: "text", maxlength: "280", "aria-label": "Reply (optional)", placeholder: "Reply (optional)" });
  const card = h("article", { class: "card", "data-request": r.id, "data-status": r.status },
    h("div", { class: "row" },
      h("h3", { class: "grow" }, who),
      h("span", { class: `pill ${late ? "late" : r.status}` }, late ? "Overdue" : LABEL[r.status] || r.status),
    ),
    h("p", { class: "muted small" }, fmtRange(r.from, r.until)),
    r.message ? h("p", null, `"${r.message}"`) : null,
    r.reply ? h("p", { class: "muted" }, `Reply: "${r.reply}"`) : null,
    r.autoDeclined ? h("p", { class: "muted small" }, "Someone else got these dates.") : null,
  );
  const actions = actionsFor(r, role, reply, after);
  if (role === "owner" && r.status === "pending") card.append(h("label", { class: "field" }, h("span", null, "Reply"), reply));
  if (actions.length) card.append(h("div", { class: "row" }, actions));
  return card;
}

function actionButton(label, kind, path, body, after, extra = {}) {
  const button = h("button", { type: "button", class: kind, onclick: () => busy(button, async () => {
    await api("POST", path, body && body());
    if (extra.toast) toast(extra.toast);
    await after();
  }) }, label);
  return button;
}

export function actionsFor(r, role, reply, after) {
  const base = `/api/requests/${r.id}`;
  const text = () => ({ reply: reply ? reply.value : "" });
  if (role === "owner") {
    if (r.status === "pending") return [actionButton("Approve", "primary", `${base}/approve`, text, after, { toast: "Approved" }), actionButton("Decline", "danger", `${base}/decline`, text, after)];
    if (r.status === "approved") return [actionButton("Handed over", "primary", `${base}/handover`, null, after, { toast: "Marked as handed over" })];
    if (r.status === "lent") return [actionButton("Returned", "primary", `${base}/return`, null, after, { toast: "Marked as returned" })];
    return [];
  }
  if (r.status === "pending" || r.status === "approved") return [actionButton("Cancel request", "danger", `${base}/cancel`, null, after)];
  return [];
}

export async function renderRequests() {
  const rerender = () => go("#/requests");
  const [incoming, outgoing] = await Promise.all([api("GET", "/api/requests"), api("GET", "/api/requests?role=outgoing")]);
  const open = (list) => list.requests.filter((r) => ["pending", "approved", "lent"].includes(r.status));
  const closed = (list) => list.requests.filter((r) => !["pending", "approved", "lent"].includes(r.status));
  const parts = [h("h1", null, "Requests"), h("h2", { style: "margin-top:0" }, "On your items")];
  parts.push(open(incoming).length ? open(incoming).map((r) => requestCard(r, "owner", rerender)) : h("p", { class: "muted" }, "No open requests on your items."));
  parts.push(h("h2", null, "Your requests"));
  parts.push(open(outgoing).length ? open(outgoing).map((r) => requestCard(r, "borrower", rerender)) : h("p", { class: "muted" }, "You have not asked to borrow anything right now."));
  const old = [...closed(incoming).map((r) => [r, "owner"]), ...closed(outgoing).map((r) => [r, "borrower"])];
  if (old.length) {
    parts.push(h("h2", null, "Earlier"), old.slice(0, 20).map(([r, role]) => requestCard(r, role, rerender)));
  }
  if (!incoming.requests.length && !outgoing.requests.length) {
    return h("div", null, h("h1", null, "Requests"), emptyState("No requests yet", "When you ask to borrow something, or a friend asks for one of your items, it shows up here."));
  }
  return h("div", null, parts);
}
