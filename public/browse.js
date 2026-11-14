import { api } from "./api.js";
import { createGroupForm } from "./groups.js";
import { photoEl } from "./photo.js";
import { requestCard } from "./requests.js";
import { go, currentGroup, redraw, setGroup, state } from "./state.js";
import { busy, emptyState, fmtAmount, fmtMoment, fmtRange, h, statusPill, toast } from "./util.js";

export async function renderBrowse() {
  const group = currentGroup();
  if (!group) {
    return h("div", null,
      h("h1", null, "Browse"),
      emptyState("No groups yet", "Create a group for your family, flatmates or club, then send them the invite link. Or open a link a friend sent you."),
      h("div", { class: "card" }, h("h2", { style: "margin-top:0" }, "Start a group"), createGroupForm(() => go("#/browse"))),
    );
  }
  const switcher = h("select", { id: "group-switch", "aria-label": "Group", onchange: (event) => { setGroup(event.target.value); go("#/browse"); } },
    state.groups.map((g) => h("option", { value: g.id, selected: g.id === group.id }, g.name)));
  const filter = h("label", { class: "check" }, h("input", { type: "checkbox", id: "available-only", checked: state.availableOnly, onchange: (event) => { state.availableOnly = event.target.checked; go("#/browse"); } }), "Available only");
  const { items } = await api("GET", `/api/groups/${group.id}/items${state.availableOnly ? "?available=1" : ""}`);
  const body = items.length
    ? h("div", { class: "grid" }, items.map(tile))
    : state.availableOnly
      ? emptyState("Nothing available right now", "Everything in this group is lent out or paused. Uncheck the filter to see it all.")
      : emptyState("Nothing here yet", "Nobody has shared an item with this group. Be the first from the My items tab.");
  return h("div", null, h("h1", null, "Browse"), h("label", { class: "field" }, h("span", null, "Group"), switcher), filter, body);
}

function tile(item) {
  return h("button", { class: "tile", type: "button", "data-item": item.id, onclick: () => go(`#/item/${item.id}`) },
    photoEl(item),
    h("span", { class: "info" },
      h("span", { class: "name" }, item.name),
      h("span", { class: "muted small" }, item.mine ? "Yours" : `From ${item.owner.name}`),
      statusPill(item, true),
      item.donation !== null ? h("span", { class: "muted small donation" }, `Suggested donation: ${fmtAmount(item.donation)}`) : null,
    ),
  );
}

export async function renderItem(id) {
  const rerender = () => redraw(`#/item/${id}`);
  const { item, history, myRequestIds } = await api("GET", `/api/items/${id}`);
  const parts = [
    h("button", { class: "link", type: "button", onclick: () => history_back(item) }, "Back"),
    photoEl(item, "big"),
    h("h1", null, item.name),
    h("div", { class: "row" }, statusPill(item), h("span", { class: "muted" }, item.mine ? "Yours" : `Owned by ${item.owner.name}`)),
    item.note ? h("p", { style: "margin-top:10px" }, item.note) : null,
    item.donation !== null ? donationNote(item) : null,
  ];

  if (item.mine) {
    parts.push(h("div", { class: "row", style: "margin:12px 0" }, h("button", { type: "button", onclick: () => go(`#/mine/edit/${item.id}`) }, "Edit item")));
    const incoming = (await api("GET", "/api/requests")).requests.filter((r) => r.item.id === item.id && ["pending", "approved", "lent"].includes(r.status));
    parts.push(h("h2", null, "Requests"));
    parts.push(incoming.length ? incoming.map((r) => requestCard(r, "owner", rerender)) : h("p", { class: "muted" }, "No open requests."));
  } else if (item.status === "paused") {
    parts.push(h("p", { class: "callout" }, `${item.owner.name} has paused this item for now.`));
  } else {
    parts.push(h("h2", null, "Request this item"), requestForm(item, rerender));
  }

  if (!item.mine && myRequestIds.length) {
    const mine = (await api("GET", "/api/requests?role=outgoing")).requests.filter((r) => myRequestIds.includes(r.id));
    parts.push(h("h2", null, "Your requests"), mine.map((r) => requestCard(r, "borrower", rerender)));
  }

  parts.push(h("h2", null, "History"));
  parts.push(
    history.length
      ? h("ul", { class: "list", "data-history": "" }, history.map((entry) =>
          h("li", null,
            h("strong", null, entry.borrower.name),
            h("div", { class: "muted small" }, `${fmtRange(entry.from, entry.until)}. Handed over ${fmtMoment(entry.handedOverAt)}${entry.returnedAt ? `, returned ${fmtMoment(entry.returnedAt)}` : ", not returned yet"}.`),
          )))
      : h("p", { class: "muted" }, "Not lent out yet."),
  );
  return h("div", null, parts);
}

function history_back() {
  if (window.history.length > 1) window.history.back();
  else go("#/browse");
}

function donationNote(item) {
  return h("div", { class: "callout", "data-donation": "" },
    h("strong", null, `Suggested donation: ${fmtAmount(item.donation)}`),
    h("div", { class: "small" }, "Paid in person or by transfer, not in the app."),
  );
}

function requestForm(item, rerender) {
  const today = state.today;
  const from = h("input", { type: "date", id: "req-from", value: today, min: today, required: true });
  const until = h("input", { type: "date", id: "req-until", value: today, min: today, required: true });
  from.addEventListener("change", () => {
    until.min = from.value || today;
    if (until.value < from.value) until.value = from.value;
  });
  const message = h("textarea", { id: "req-message", maxlength: "280", placeholder: "What do you need it for?" });
  const error = h("p", { class: "error-text", role: "alert" });
  const send = h("button", { class: "primary block", type: "submit" }, "Send request");
  const form = h("form", { class: "card" },
    h("div", { class: "row" },
      h("label", { class: "field grow" }, h("span", null, "From"), from),
      h("label", { class: "field grow" }, h("span", null, "Until"), until),
    ),
    h("label", { class: "field" }, h("span", null, "Message"), message),
    error,
    send,
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    busy(send, async () => {
      try {
        await api("POST", `/api/items/${item.id}/requests`, { from: from.value, until: until.value, message: message.value });
        toast("Request sent");
        await rerender();
      } catch (e) {
        error.textContent = e.message;
      }
    });
  });
  return form;
}

