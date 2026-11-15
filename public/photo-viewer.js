import { icon } from "./icons.js";
import { showOverlay } from "./overlay.js";
import { h } from "./util.js";

const LOCK = "pv-open";

/** The rectangle a picture takes inside a box with object-fit: contain, as { x, y, width, height }. */
export function containedRect(boxW, boxH, picW, picH) {
  if (!(picW > 0 && picH > 0)) return { x: 0, y: 0, width: boxW, height: boxH };
  const scale = Math.min(boxW / picW, boxH / picH);
  const width = picW * scale;
  const height = picH * scale;
  return { x: (boxW - width) / 2, y: (boxH - height) / 2, width, height };
}

/** True when a point (relative to the box's top left) lands on the picture itself, not on the empty space around it. */
export function onPicture(point, boxW, boxH, picW, picH) {
  const r = containedRect(boxW, boxH, picW, picH);
  return point.x >= r.x && point.x <= r.x + r.width && point.y >= r.y && point.y <= r.y + r.height;
}

/** Makes a loaded item photo (from photoEl) open the viewer on tap, Enter or Space. Returns the same element. */
export function viewable(img, item) {
  img.classList.add("viewable");
  img.setAttribute("role", "button");
  img.setAttribute("tabindex", "0");
  img.setAttribute("aria-label", `View photo of ${item.name}`);
  const open = () => {
    if (img.src) openPhotoViewer(img.src, item.name, img);
  };
  img.addEventListener("click", open);
  img.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    open();
  });
  return img;
}

/**
 * Opens a photo full screen: dark backdrop, the photo fitted inside it, a close button.
 * Closes on the button, a tap on the backdrop (not the photo), Escape and the Back button.
 * `trigger` is the element to give focus back to. Returns { close }.
 */
export function openPhotoViewer(src, name, trigger) {
  const close = h("button", { class: "pv-close", type: "button", "aria-label": "Close photo", onclick: () => view.close() }, icon("close"));
  const img = h("img", { class: "pv-img", src, alt: "", draggable: "false" });
  const root = h("div", {
    class: "pv",
    role: "dialog",
    "aria-modal": "true",
    "aria-label": `Photo of ${name}`,
    onclick: (event) => {
      if (event.target === close || close.contains(event.target)) return;
      if (event.target === img) {
        const box = img.getBoundingClientRect();
        const point = { x: event.clientX - box.left, y: event.clientY - box.top };
        if (onPicture(point, box.width, box.height, img.naturalWidth, img.naturalHeight)) return;
      }
      view.close();
    },
    onkeydown: (event) => {
      // The close button is the only control, so Tab stays on it.
      if (event.key === "Tab") {
        event.preventDefault();
        close.focus({ preventScroll: true });
      }
    },
  }, img, close);
  document.documentElement.classList.add(LOCK);
  const view = showOverlay(root, {
    focus: close,
    returnFocus: trigger,
    onClose: () => document.documentElement.classList.remove(LOCK),
  });
  return view;
}
