import { CHANGELOG } from "./changelog.js";
import { SEEN_KEY, formatEntryDate, latestId, unseenEntries } from "./whats-new.js";
import { h } from "./util.js";

let checked = false;
let open = null;

function readSeen() {
  try {
    return localStorage.getItem(SEEN_KEY) || null;
  } catch {
    return null;
  }
}

function writeSeen(id) {
  if (!id) return;
  try {
    localStorage.setItem(SEEN_KEY, id);
  } catch {
    /* storage can be full or blocked */
  }
}

/** Call right after a brand-new sign-up, so a new person does not start with a pile of old news. */
export function markNewAccountSeen() {
  writeSeen(latestId(CHANGELOG));
}

/**
 * Once per page load, with the main app on screen: slide up whatever the person has not seen.
 * No seen key means a session from before this feature, so they get everything.
 */
export function considerWhatsNew() {
  if (checked) return;
  checked = true;
  const fresh = unseenEntries(CHANGELOG, readSeen());
  if (fresh.length) openSheet(fresh, true);
}

/** The full list, reopened from the You tab. */
export function openWhatsNewList() {
  if (CHANGELOG.length) openSheet(CHANGELOG, false);
}

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function entryView(entry) {
  return h("article", { class: "wn-entry" },
    h("p", { class: "wn-date" }, formatEntryDate(entry.date)),
    h("h3", null, entry.title),
    h("ul", null, entry.bullets.map((bullet) => h("li", null, bullet))),
  );
}

function openSheet(entries, popup) {
  if (open) return;
  const close = () => closeSheet(layer);
  const grabber = h("div", { class: "grabber" });
  const head = h("div", { class: "sheet-head" },
    grabber,
    h("h2", { id: "wn-title" }, "What's new"),
    h("p", { class: "muted small" }, popup ? "Since you last opened Loaner." : "Recent changes to Loaner."),
  );
  const done = h("button", { type: "button", class: "primary block", onclick: close }, popup ? "Got it" : "Done");
  const sheet = h("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-labelledby": "wn-title" },
    head,
    h("div", { class: "sheet-scroll" }, entries.map(entryView)),
    h("div", { class: "sheet-dock" }, done),
  );
  const scrim = h("button", { type: "button", class: "scrim", "aria-label": "Close", tabindex: "-1", onclick: close });
  const layer = h("div", { class: "sheet-layer" }, scrim, sheet);
  bindSwipe(head, sheet, close);
  const onKey = (event) => event.key === "Escape" && close();
  document.addEventListener("keydown", onKey);
  open = { onKey };
  document.documentElement.classList.add("sheet-open");
  document.body.append(layer);
  done.focus({ preventScroll: true });
}

function closeSheet(layer) {
  if (!open) return;
  document.removeEventListener("keydown", open.onKey);
  open = null;
  writeSeen(latestId(CHANGELOG));
  document.documentElement.classList.remove("sheet-open");
  const remove = () => layer.remove();
  if (reduced()) return remove();
  layer.querySelector(".sheet").style.transform = "";
  layer.classList.add("closing");
  setTimeout(remove, 220);
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
