import { api } from "./api.js";
import { messageButton } from "./messages.js";
import { photoEl } from "./photo.js";
import { redraw, state } from "./state.js";
import { busy, emptyState, fmtDate, fmtRange, h, largeTitleHead, toast } from "./util.js";

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
    h("div", { class: "req-head" },
      h("div", { class: "thumb" }, photoEl(r.item)),
      h("div", { class: "grow" },
        h("h3", null, who),
        h("p", { class: "req-meta" }, r.status === "lent" ? [h("span", { class: `due${late ? " late" : ""}` }, `due ${fmtDate(r.until)}`), ` \u00b7 from ${fmtDate(r.from)}`] : fmtRange(r.from, r.until)),
        h("span", { class: `pill ${late ? "late" : r.status}` }, late ? "Overdue" : LABEL[r.status] || r.status),
      ),
    ),
    r.message ? h("p", { class: "quote" }, `"${r.message}"`) : null,
    r.reply ? h("p", { class: "reply" }, `Reply: "${r.reply}"`) : null,
    r.autoDeclined ? h("p", { class: "reply" }, "Someone else got these dates.") : null,
  );
  const actions = actionsFor(r, role, reply, after);
  if (role === "owner" && r.status === "pending") card.append(h("label", { class: "field", style: "margin:12px 0 0" }, h("span", null, "Reply"), reply));
  // Both sides open the same (item, borrower) thread.
  actions.push(messageButton(r.item.id, role === "owner" ? r.borrower.id : null, r.unreadMessages));
  card.append(h("div", { class: "acts" }, actions));
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
    if (r.status === "pending") return [actionButton("Decline", "", `${base}/decline`, text, after), actionButton("Approve", "primary", `${base}/approve`, text, after, { toast: "Approved" })];
    if (r.status === "approved") return [actionButton("Handed over", "primary", `${base}/handover`, null, after, { toast: "Marked as handed over" })];
    if (r.status === "lent") return [actionButton("Returned", "primary", `${base}/return`, null, after, { toast: "Marked as returned" })];
    return [];
  }
  if (r.status === "pending" || r.status === "approved") return [actionButton("Cancel request", "", `${base}/cancel`, null, after)];
  return [];
}

export async function renderRequests() {
  const rerender = () => redraw("#/requests");
  const [incoming, outgoing] = await Promise.all([api("GET", "/api/requests"), api("GET", "/api/requests?role=outgoing")]);
  const open = (list) => list.requests.filter((r) => ["pending", "approved"].includes(r.status));
  const onLoan = [...incoming.requests.filter((r) => r.status === "lent").map((r) => [r, "owner"]), ...outgoing.requests.filter((r) => r.status === "lent").map((r) => [r, "borrower"])];
  const closed = (list) => list.requests.filter((r) => !["pending", "approved", "lent"].includes(r.status));
  const label = (text) => h("h2", { class: "label" }, text);
  const parts = [largeTitleHead("Requests"), label("On your items")];
  parts.push(open(incoming).length ? open(incoming).map((r) => requestCard(r, "owner", rerender)) : h("p", { class: "muted" }, "No open requests on your items."));
  parts.push(label("Your requests"));
  parts.push(open(outgoing).length ? open(outgoing).map((r) => requestCard(r, "borrower", rerender)) : h("p", { class: "muted" }, "You have not asked to borrow anything right now."));
  if (onLoan.length) parts.push(label("On loan"), onLoan.map(([r, role]) => requestCard(r, role, rerender)));
  const old = [...closed(incoming).map((r) => [r, "owner"]), ...closed(outgoing).map((r) => [r, "borrower"])];
  if (old.length) {
    parts.push(label("Earlier"), old.slice(0, 20).map(([r, role]) => requestCard(r, role, rerender)));
  }
  if (!incoming.requests.length && !outgoing.requests.length) {
    return h("div", null, largeTitleHead("Requests"), emptyState("No requests yet", "When you ask to borrow something, or a friend asks for one of your items, it shows up here."));
  }
  return h("div", null, parts);
}
