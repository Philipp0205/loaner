import { api } from "./api.js";
import { alertsBell, tabHead } from "./alerts/bell.js";
import { DONATION_COPY } from "./donation/copy.js";
import { donationLabel, hasDonation } from "./donation/label.js";
import { createGroupForm } from "./groups.js";
import { photoEl } from "./photo.js";
import { photoGallery } from "./photos/gallery.js";
import { messageButton } from "./messages.js";
import { requestCard } from "./requests.js";
import { go, currentGroup, redraw, setGroup, state } from "./state.js";
import { busy, emptyState, fmtDate, fmtMoment, fmtRange, h, skeletonList, statusPill, swrList, toast, wordmarkHeading } from "./util.js";
import { icon } from "./icons.js";

export async function renderBrowse() {
  const group = currentGroup();
  if (!group) {
    return h("div", null,
      h("div", { class: "page-head brandbar" }, wordmarkHeading(), alertsBell()),
      emptyState("No groups yet", "Create a group for your family, flatmates or club, then send them the invite link. Or open a link a friend sent you."),
      h("div", { class: "card" }, h("h2", { style: "margin-top:0" }, "Start a group"), createGroupForm(() => go("#/browse"))),
    );
  }
  const select = h("select", { id: "group-switch", "aria-label": "Group", onchange: (event) => { setGroup(event.target.value); go("#/browse"); } },
    state.groups.map((g) => h("option", { value: g.id, selected: g.id === group.id }, g.name)));
  const filter = h("label", { class: "chip" },
    h("input", { type: "checkbox", id: "available-only", checked: state.availableOnly, onchange: (event) => { state.availableOnly = event.target.checked; go("#/browse"); } }),
    "Available only");
  const grid = h("div", { class: "swr-mount" });
  swrList(
    grid,
    `browse:${state.user.id}:${group.id}:${state.availableOnly ? 1 : 0}`,
    () => api("GET", `/api/groups/${group.id}/items${state.availableOnly ? "?available=1" : ""}`),
    ({ items }) => (items.length
      ? h("div", { class: "grid" }, items.map(tile))
      : state.availableOnly
        ? emptyState("Nothing available right now", "Everything in this group is lent out or paused. Uncheck the filter to see it all.")
        : emptyState("Nothing here yet", "Nobody has shared an item with this group. Be the first from the My items tab.")),
    () => skeletonList("tile", 6),
  );
  return h("div", null,
    tabHead("Browse", h("span", { class: "switch" }, select)),
    h("div", { class: "chips" }, filter),
    grid);
}

function tile(item) {
  const lent = item.status === "lent";
  return h("button", { class: "tile", type: "button", "data-item": item.id, onclick: () => go(`#/item/${item.id}`) },
    h("span", { class: "shot" }, photoEl(item), lent ? h("span", { class: "lent-badge" }, "Lent") : null),
    h("span", { class: "info" },
      h("span", { class: "name" }, item.name),
      lent ? h("span", { class: "who" }, `With ${item.lent.to.name} \u00b7 back ${fmtDate(item.lent.until)}`) : null,
      hasDonation(item)
        ? h("span", { class: "donation" }, `${DONATION_COPY.prefix}${donationLabel(item)}`)
        : lent ? null : h("span", { class: "free" }, "Free to borrow"),
      h("span", { class: "who" }, item.mine ? "Yours" : `From ${item.owner.name}`),
      statusPill(item, true),
    ),
  );
}

export async function renderItem(id) {
  const rerender = () => redraw(`#/item/${id}`);
  const { item, history, myRequestIds, unreadMessages } = await api("GET", `/api/items/${id}`);
  const parts = [
    h("div", { class: "hero" },
      photoGallery(item),
      h("button", { class: "fab", type: "button", "aria-label": "Back", onclick: () => history_back(item) }, icon("back")),
    ),
    h("h1", null, item.name),
    h("div", { class: "row" }, statusPill(item), item.category ? h("span", { class: "muted small", "data-category": "" }, item.category) : null, item.mine ? h("span", { class: "muted small" }, "Yours") : null),
    h("hr", { class: "rule" }),
    h("div", { class: "host" },
      h("span", { class: "avatar", "aria-hidden": "true" }, (item.owner.name || "?").slice(0, 1).toUpperCase()),
      h("div", null, h("b", null, item.mine ? "Lent by you" : `Owned by ${item.owner.name}`), h("span", { class: "sub" }, item.mine ? "Shared with your groups" : "Member of the group")),
      item.mine ? null : messageButton(item.id, null, unreadMessages),
    ),
    item.note ? [h("hr", { class: "rule" }), h("p", { class: "note" }, item.note)] : null,
    hasDonation(item) ? [h("hr", { class: "rule" }), donationNote(item)] : null,
  ];
  let bar = null;

  if (item.mine) {
    bar = stickyBar(item, h("button", { class: "primary", type: "button", onclick: () => go(`#/mine/edit/${item.id}`) }, "Edit item"));
    const incoming = (await api("GET", "/api/requests")).requests.filter((r) => r.item.id === item.id && ["pending", "approved", "lent"].includes(r.status));
    parts.push(h("h2", null, "Requests"));
    parts.push(incoming.length ? incoming.map((r) => requestCard(r, "owner", rerender)) : h("p", { class: "muted" }, "No open requests."));
  } else if (item.status === "paused") {
    parts.push(h("p", { class: "callout" }, `${item.owner.name} has paused this item for now.`));
  } else {
    const { form, submit } = requestForm(item, rerender);
    parts.push(form);
    bar = stickyBar(item, submit);
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
  return h("div", { class: "detail" }, parts, bar);
}

/** Sticky bar above the tab bar: the suggested amount on the left, the main action on the right. */
function stickyBar(item, action) {
  const left = hasDonation(item)
    ? h("div", { class: "left" }, h("div", { class: "amt" }, donationLabel(item)), h("div", { class: "sub" }, DONATION_COPY.shortLabel))
    : h("div", { class: "left" }, h("div", { class: "amt" }, "Free"), h("div", { class: "sub" }, "to borrow"));
  return h("div", { class: "bar", "data-bar": "" }, left, action);
}

function history_back() {
  if (window.history.length > 1) window.history.back();
  else go("#/browse");
}

function donationNote(item) {
  return h("div", { class: "donation-note", "data-donation": "" },
    h("strong", null, `${DONATION_COPY.prefix}${donationLabel(item)}`),
    "Paid in person or by transfer, not in the app.",
  );
}

/** The date block and message stay on the page. The submit button lives in the sticky bar. */
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
  const send = h("button", { class: "primary", type: "submit", form: "request-form", "aria-label": "Send request" }, "Request");
  const form = h("form", { class: "request-form", id: "request-form" },
    h("div", { class: "dates" },
      h("label", { class: "date" }, h("span", null, "From"), from),
      h("label", { class: "date" }, h("span", null, "Until"), until),
    ),
    h("label", { class: "field" }, h("span", null, "Message"), message),
    error,
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
  return { form, submit: send };
}

