import { api } from "./api.js";
import { CATEGORIES } from "./categories.js";
import { clearDraft, getDraft } from "./draft.js";
import { DONATION_COPY } from "./donation/copy.js";
import { donationInputValue, hasDonation } from "./donation/label.js";
import { donationFields, parseDonation } from "./donation/parse.js";
import { photoEl } from "./photo.js";
import { PHOTO_COPY } from "./photos/copy.js";
import { photoPicker } from "./photos/picker.js";
import { go, redraw, state, stayedPut } from "./state.js";
import { busy, emptyState, h, largeTitleHead, skeletonList, statusPill, swrList, toast } from "./util.js";

export async function renderMine() {
  const add = h("button", { class: "primary", type: "button", onclick: () => go("#/mine/new") }, "Add an item");
  const rerender = () => redraw("#/mine");
  const head = largeTitleHead("My items", add);
  if (!state.groups.length) {
    return h("div", null, head, emptyState("Join or create a group first", "Items are shared with your groups. Open the Browse tab to create one."));
  }
  const list = h("div", { class: "swr-mount" });
  swrList(
    list,
    `mine:${state.user.id}`,
    () => api("GET", "/api/items/mine"),
    ({ items }) => (items.length
      ? items.map((item) => mineCard(item, rerender))
      : emptyState("Nothing listed yet", "Got a drill, a tent or a board game gathering dust? Add it and choose who can borrow it.")),
    () => skeletonList("card", 3),
  );
  return h("div", null, head, list);
}

function mineCard(item, rerender) {
  const toggle = h("button", { type: "button", onclick: () => busy(toggle, async () => {
    await api("PATCH", `/api/items/${item.id}`, { available: !item.available });
    toast(item.available ? "Paused" : "Available again");
    await rerender();
  }) }, item.available ? "Pause" : "Make available");
  const groupNames = item.groupIds.map((id) => (state.groups.find((g) => g.id === id) || { name: "?" }).name).join(", ");
  return h("article", { class: "card", "data-item": item.id },
    h("div", { class: "req-head" },
      h("div", { class: "thumb" }, photoEl(item)),
      h("div", { class: "grow" }, h("h3", null, item.name), h("p", { class: "req-meta" }, `Shared with ${groupNames}`), item.category ? h("p", { class: "req-meta", "data-category": "" }, item.category) : null, statusPill(item)),
    ),
    h("div", { class: "acts" },
      h("button", { type: "button", onclick: () => go(`#/item/${item.id}`) }, "Open"),
      h("button", { type: "button", onclick: () => go(`#/mine/edit/${item.id}`) }, "Edit"),
      toggle,
    ),
  );
}

export async function renderItemForm(id) {
  const existing = id ? (await api("GET", `/api/items/${id}`)).item : null;
  if (id && !existing.mine) throw new Error("Only the owner can edit this item.");
  const draft = existing ? null : getDraft();
  const name = h("input", { type: "text", id: "item-name", maxlength: "60", required: true, value: existing ? existing.name : "" });
  const category = h("select", { id: "item-category" },
    h("option", { value: "" }, "Choose a category"),
    CATEGORIES.map((c) => h("option", { value: c }, c)));
  category.value = existing ? existing.category || "" : "";
  const note = h("textarea", { id: "item-note", maxlength: "280", placeholder: "Battery lasts about 30 min" });
  note.value = existing ? existing.note : "";
  const picker = photoPicker(existing, draft ? draft.blobs : []);
  const wantsDonation = h("input", { type: "checkbox", id: "item-donation-on", checked: !!(existing && hasDonation(existing)) });
  const amount = h("input", { type: "text", id: "item-donation", maxlength: "60", placeholder: DONATION_COPY.placeholder, value: donationInputValue(existing) });
  const amountField = h("label", { class: "field" }, h("span", null, DONATION_COPY.label), amount);
  const sync = () => amountField.classList.toggle("hidden", !wantsDonation.checked);
  wantsDonation.addEventListener("change", sync);
  sync();
  const chosen = new Set(existing ? existing.groupIds : state.groupId ? [state.groupId] : []);
  const boxes = state.groups.map((g) => h("label", { class: "check" }, h("input", { type: "checkbox", value: g.id, "data-group": g.id, checked: chosen.has(g.id), onchange: (event) => (event.target.checked ? chosen.add(g.id) : chosen.delete(g.id)) }), g.name));
  const error = h("p", { class: "error-text", role: "alert" });
  const save = h("button", { class: "primary block", type: "submit" }, existing ? "Save changes" : "Add item");
  const form = h("form", { class: "stack item-form" },
    h("h1", null, existing ? "Edit item" : "Add an item"),
    h("label", { class: "field" }, h("span", null, "Name"), name),
    h("label", { class: "field" }, h("span", null, "Category"), category),
    h("label", { class: "field" }, h("span", null, "Short note"), note),
    h("div", { class: "field" }, h("span", null, "Photos"), picker.node),
    h("label", { class: "check toggle-row" }, wantsDonation, DONATION_COPY.toggle),
    amountField,
    h("p", { class: "hint" }, DONATION_COPY.hint),
    h("fieldset", null, h("legend", null, "Share with"), boxes),
    error,
    save,
    h("button", { class: "link block", type: "button", onclick: () => { clearDraft(); go("#/mine"); } }, "Cancel"),
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const samePlace = stayedPut();
    busy(save, async () => {
      try {
        let fields = donationFields(null);
        if (wantsDonation.checked) {
          const parsed = parseDonation(amount.value);
          if (parsed.error) throw new Error(parsed.error);
          fields = donationFields(parsed);
        }
        const body = { name: name.value, note: note.value, category: category.value || null, ...fields, groupIds: [...chosen] };
        let itemId = id;
        if (existing) await api("PATCH", `/api/items/${id}`, body);
        else itemId = (await api("POST", "/api/items", body)).item.id;
        const failed = await syncPhotos(itemId, picker);
        if (!existing) clearDraft();
        if (failed) {
          // The item exists now, so send the person to its edit page to add the photo again, not to a second create.
          toast(PHOTO_COPY.uploadFailed, "error");
          if (samePlace()) go(`#/mine/edit/${itemId}`);
          return;
        }
        toast(existing ? "Saved" : "Item added");
        if (samePlace()) go(`#/item/${itemId}`);
      } catch (e) {
        error.textContent = e.message;
      }
    });
  });
  const parts = [form];
  if (existing) {
    const del = h("button", { class: "danger block", type: "button", style: "margin-top:20px", onclick: () => deleteItem(existing, del) }, "Delete item");
    parts.push(del);
  }
  return h("div", null, parts);
}

/** Deletes the removed photos, then uploads the new ones one at a time. Returns true if any step failed. */
async function syncPhotos(itemId, picker) {
  let failed = false;
  for (const photoId of picker.removed()) {
    try {
      await api("DELETE", `/api/items/${itemId}/photos/${photoId}`);
    } catch {
      failed = true;
    }
  }
  for (const blob of picker.added()) {
    try {
      await api("POST", `/api/items/${itemId}/photos`, undefined, blob);
    } catch {
      failed = true;
    }
  }
  return failed;
}

async function deleteItem(item, button) {
  if (!confirm(`Delete ${item.name}? Open requests for it will be closed.`)) return;
  const samePlace = stayedPut();
  await busy(button, async () => {
    await api("DELETE", `/api/items/${item.id}`);
    toast("Item deleted");
    if (samePlace()) go("#/mine");
  });
}
