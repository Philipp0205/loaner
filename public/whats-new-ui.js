import { CHANGELOG } from "./changelog.js";
import { showSheet } from "./sheet.js";
import { SEEN_KEY, formatEntryDate, latestId, unseenEntries } from "./whats-new.js";
import { h } from "./util.js";

let checked = false;

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

function entryView(entry) {
  return h("article", { class: "wn-entry" },
    h("p", { class: "wn-date" }, formatEntryDate(entry.date)),
    h("h3", null, entry.title),
    h("ul", null, entry.bullets.map((bullet) => h("li", null, bullet))),
  );
}

function openSheet(entries, popup) {
  let control = null;
  const head = h("div", { class: "sheet-head" },
    h("div", { class: "grabber" }),
    h("h2", { id: "wn-title" }, "What's new"),
    h("p", { class: "muted small" }, popup ? "Since you last opened Loan some." : "Recent changes to Loan some."),
  );
  const done = h("button", { type: "button", class: "primary block", onclick: () => control?.close() }, popup ? "Got it" : "Done");
  const sheet = h("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-labelledby": "wn-title" },
    head,
    h("div", { class: "sheet-scroll" }, entries.map(entryView)),
    h("div", { class: "sheet-dock" }, done),
  );
  control = showSheet(sheet, head, { onClose: () => writeSeen(latestId(CHANGELOG)), focus: done });
}
