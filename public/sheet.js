import { h } from "./util.js";

let current = null;

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Slides a bottom sheet up over a scrim. `sheet` is the .sheet element, `head` the part you can drag.
 * Closes by scrim, swipe down, Escape or the returned close(). One sheet at a time: returns null if one is open.
 * `onClose` runs once, when it starts closing.
 */
export function showSheet(sheet, head, { onClose, focus } = {}) {
  if (current) return null;
  const close = () => {
    if (current !== state) return;
    current = null;
    document.removeEventListener("keydown", onKey);
    onClose?.();
    document.documentElement.classList.remove("sheet-open");
    if (reduced()) return layer.remove();
    sheet.style.transform = "";
    layer.classList.add("closing");
    setTimeout(() => layer.remove(), 220);
  };
  const scrim = h("button", { type: "button", class: "scrim", "aria-label": "Close", tabindex: "-1", onclick: close });
  const layer = h("div", { class: "sheet-layer" }, scrim, sheet);
  const onKey = (event) => event.key === "Escape" && close();
  const state = { close };
  bindSwipe(head, sheet, close);
  document.addEventListener("keydown", onKey);
  current = state;
  document.documentElement.classList.add("sheet-open");
  document.body.append(layer);
  focus?.focus({ preventScroll: true });
  return state;
}

/** Drag down on the head or grabber to dismiss. A short drag springs back. */
function bindSwipe(head, sheet, close) {
  let startY = 0;
  let drag = 0;
  let pointer = -1;
  head.addEventListener("pointerdown", (event) => {
    if (event.button != null && event.button !== 0) return;
    pointer = event.pointerId;
    startY = event.clientY;
    drag = 0;
    sheet.classList.add("dragging");
    head.setPointerCapture?.(pointer);
  });
  head.addEventListener("pointermove", (event) => {
    if (event.pointerId !== pointer) return;
    drag = Math.max(0, event.clientY - startY);
    sheet.style.transform = `translateY(${drag}px)`;
  });
  const end = (event) => {
    if (event.pointerId !== pointer) return;
    pointer = -1;
    sheet.classList.remove("dragging");
    if (drag > 72) close();
    else sheet.style.transform = "";
  };
  head.addEventListener("pointerup", end);
  head.addEventListener("pointercancel", end);
}
