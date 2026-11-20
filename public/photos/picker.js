import { downscale, photoElAt } from "../photo.js";
import { h, toast } from "../util.js";
import { PHOTO_COPY, pickerCount } from "./copy.js";
import { limitFiles, slotsLeft } from "./pure.js";

/**
 * The photo editor in the item form: thumbnails with a remove button, and a multiple file input.
 * `existing` is the item when editing (its saved photos show first), or null. Removals wait for Save.
 * Returns { node, added(), removed(), count() }: the new blobs, the saved photo ids to delete, and the total shown.
 */
export function photoPicker(existing, startBlobs = []) {
  const entries = [
    ...(existing && existing.photoIds ? existing.photoIds.map((id) => ({ id })) : []),
    ...startBlobs.map((blob) => ({ blob })),
  ];
  const removedIds = [];
  const grid = h("div", { class: "picker-grid", "data-picker": "" });
  const count = h("p", { class: "hint picker-count", role: "status" });
  const input = h("input", { type: "file", id: "item-photo", accept: "image/*", multiple: true, "aria-label": PHOTO_COPY.addPhotos });

  const thumb = (entry) => (entry.id
    ? photoElAt(existing, entry.id, "preview")
    : h("img", { class: "preview", alt: "New photo preview", src: (entry.url ||= URL.createObjectURL(entry.blob)) }));

  function draw() {
    grid.replaceChildren(...entries.map((entry, index) => h("div", { class: "picker-item" },
      thumb(entry),
      h("button", { class: "picker-remove", type: "button", "aria-label": `${PHOTO_COPY.removePhoto} ${index + 1}`, onclick: () => remove(entry) }, "\u00d7"),
    )));
    count.textContent = entries.length ? pickerCount(entries.length) : PHOTO_COPY.noPhotos;
    input.disabled = slotsLeft(entries.length) === 0;
  }

  function remove(entry) {
    if (entry.id) removedIds.push(entry.id);
    entries.splice(entries.indexOf(entry), 1);
    draw();
  }

  // Shrinks the picked files and adds the ones that fit. A bad file is reported and the rest are kept.
  input.addEventListener("change", async () => {
    const files = Array.from(input.files);
    input.value = "";
    const { kept, dropped } = limitFiles(files, entries.length);
    if (dropped) toast(kept.length ? PHOTO_COPY.onlySome : PHOTO_COPY.full);
    for (const file of kept) {
      try {
        entries.push({ blob: await downscale(file) });
      } catch (e) {
        toast(e.message, "error");
      }
    }
    draw();
  });

  draw();
  return {
    node: h("div", { class: "picker" }, grid, count, input),
    added: () => entries.filter((entry) => entry.blob).map((entry) => entry.blob),
    removed: () => [...removedIds],
    count: () => entries.length,
  };
}
