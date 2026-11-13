import { fetchBlob } from "./api.js";
import { h } from "./util.js";

const urls = new Map();

/** A blob URL for an item's photo, cached per item and edit version. */
async function photoUrl(item) {
  const key = `${item.id}:${item.photoVersion}`;
  if (!urls.has(key)) {
    urls.set(key, fetchBlob(`/api/items/${item.id}/photo`).then((blob) => (blob ? URL.createObjectURL(blob) : null)));
  }
  return urls.get(key);
}

/** An <img> for the item, or a plain placeholder when it has no photo. */
export function photoEl(item, extra = "") {
  if (!item.hasPhoto) return h("div", { class: `photo none ${extra}` }, "No photo");
  const img = h("img", { class: `photo ${extra}`, alt: `Photo of ${item.name}`, loading: "lazy" });
  photoUrl(item).then((url) => {
    if (url) img.src = url;
  });
  return img;
}

/** Shrinks a picked image to at most `max` pixels on the long side and returns a JPEG blob under 2 MB. */
export async function downscale(file, max = 1200) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("That file is not a picture we can read.");
  }
  let scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  for (const quality of [0.85, 0.7, 0.5]) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= 2 * 1024 * 1024) return blob;
    scale *= 0.75;
  }
  throw new Error("That picture is too large. Try a smaller one.");
}
