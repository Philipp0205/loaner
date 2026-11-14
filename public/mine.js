import { api } from "./api.js";
import { downscale, photoEl } from "./photo.js";
import { go, redraw, state, stayedPut } from "./state.js";
import { busy, emptyState, fmtAmountPlain, h, statusPill, toast } from "./util.js";

export async function renderMine() {
  const { items } = await api("GET", "/api/items/mine");
  const add = h("button", { class: "primary", type: "button", onclick: () => go("#/mine/new") }, "Add an item");
  const rerender = () => redraw("#/mine");
  const head = h("div", { class: "page-head" }, h("h1", null, "My items"), add);
  if (!state.groups.length) {
    return h("div", null, head, emptyState("Join or create a group first", "Items are shared with your groups. Open the Browse tab to create one."));
  }
  if (!items.length) return h("div", null, head, emptyState("Nothing listed yet", "Got a drill, a tent or a board game gathering dust? Add it and choose who can borrow it."));
  return h("div", null, head, items.map((item) => mineCard(item, rerender)));
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
      h("div", { class: "grow" }, h("h3", null, item.name), h("p", { class: "req-meta" }, `Shared with ${groupNames}`), statusPill(item)),
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
  const name = h("input", { type: "text", id: "item-name", maxlength: "60", required: true, value: existing ? existing.name : "" });
  const note = h("textarea", { id: "item-note", maxlength: "280", placeholder: "Battery lasts about 30 min" });
  note.value = existing ? existing.note : "";
  let blob = null;
  const preview = h("div", null, existing && existing.hasPhoto ? photoEl(existing, "preview") : null);
  const file = h("input", { type: "file", id: "item-photo", accept: "image/*", onchange: async () => {
    const picked = file.files[0];
    if (!picked) return;
    try {
      blob = await downscale(picked);
      const img = h("img", { class: "preview", alt: "New photo preview", src: URL.createObjectURL(blob) });
      preview.replaceChildren(img);
    } catch (e) {
      blob = null;
      toast(e.message, "error");
    }
  } });
  const wantsDonation = h("input", { type: "checkbox", id: "item-donation-on", checked: !!(existing && existing.donation !== null) });
  const amount = h("input", { type: "text", id: "item-donation", inputmode: "decimal", placeholder: "5", value: existing && existing.donation !== null ? fmtAmountPlain(existing.donation) : "" });
  const amountField = h("label", { class: "field" }, h("span", null, "Suggested amount (EUR)"), h("span", { class: "money-input" }, h("span", { class: "money-sign", "aria-hidden": "true" }, "€"), amount));
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
    h("label", { class: "field" }, h("span", null, "Short note"), note),
    h("div", { class: "field" }, h("span", null, "Photo"), preview, file),
    h("label", { class: "check toggle-row" }, wantsDonation, "Ask for a donation"),
    amountField,
    h("p", { class: "hint" }, "Display only. Money is never handled in the app."),
    h("fieldset", null, h("legend", null, "Share with"), boxes),
    error,
    save,
    h("button", { class: "link block", type: "button", onclick: () => go("#/mine") }, "Cancel"),
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const samePlace = stayedPut();
    busy(save, async () => {
      try {
        let donation = null;
        if (wantsDonation.checked) {
          donation = Number(amount.value.replace(",", "."));
          if (!amount.value.trim() || !Number.isFinite(donation)) throw new Error("Enter the suggested amount in euros as a number.");
        }
        const body = { name: name.value, note: note.value, donation, groupIds: [...chosen] };
        let itemId = id;
        if (existing) await api("PATCH", `/api/items/${id}`, body);
        else itemId = (await api("POST", "/api/items", body)).item.id;
        if (blob) await api("PUT", `/api/items/${itemId}/photo`, undefined, blob);
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
    if (existing.hasPhoto) {
      const drop = h("button", { class: "block", type: "button", style: "margin-top:10px", onclick: () => busy(drop, async () => { await api("DELETE", `/api/items/${id}/photo`); toast("Photo removed"); redraw(`#/mine/edit/${id}`); }) }, "Remove photo");
      parts.push(drop);
    }
  }
  return h("div", null, parts);
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
