import { normalizeEntries } from "./whats-new.js";

/**
 * What's new entries, newest first. Add new ones at the top.
 * id: lowercase letters, digits and dashes. date: YYYY-MM-DD. Keep copy short and plain.
 * @type {import("./whats-new.js").Entry[]}
 */
const RAW = [
  {
    id: "2026-11-14-whats-new-sheet",
    date: "2026-11-14",
    title: "A What's new note",
    bullets: [
      "When Loaner changes, a short note slides up the next time you open it.",
      "Tap Got it, tap outside it, or swipe it down to close it.",
      "You can read it again any time from the You tab.",
    ],
  },
  {
    id: "2026-11-14-shelf-redesign",
    date: "2026-11-14",
    title: "A new look",
    bullets: [
      "Every screen is restyled: light, clean and easy to use on a phone.",
      "Loaner now uses the Inter font and a teal accent.",
      "The styles are split into small files, so updates stay quick.",
    ],
  },
  {
    id: "2026-11-13-euros-and-tabs",
    date: "2026-11-13",
    title: "Euros and a steadier You tab",
    bullets: [
      "Suggested donations now show with a euro sign, like €5.",
      "Creating a group no longer pulls you back to Browse if you have already moved to another tab.",
    ],
  },
];

export const CHANGELOG = normalizeEntries(RAW);
