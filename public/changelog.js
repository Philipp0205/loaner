import { normalizeEntries } from "./whats-new.js";

/**
 * What's new entries, newest first. Add new ones at the top.
 * id: lowercase letters, digits and dashes. date: YYYY-MM-DD. Keep copy short and plain.
 * @type {import("./whats-new.js").Entry[]}
 */
const RAW = [
  {
    id: "2026-11-15-messages",
    date: "2026-11-15",
    title: "Messages",
    bullets: [
      "You can message the person who is lending something, from the item or from a request.",
      "They can reply, and you will see a dot when there is something new.",
    ],
  },
  {
    id: "2026-11-15-group-members",
    date: "2026-11-15",
    title: "See who is in your group",
    bullets: [
      "The You tab now lists everyone in each group.",
      "Each person shows whether their notifications are on.",
    ],
  },
  {
    id: "2026-11-15-dark-mode",
    date: "2026-11-15",
    title: "Dark mode",
    bullets: [
      "Loan some follows your phone's light or dark setting.",
      "The logo stays readable on a dark background.",
    ],
  },
  {
    id: "2026-11-15-install-prompt",
    date: "2026-11-15",
    title: "Install the app",
    bullets: [
      "You can install Loan some on your phone from a prompt in the app.",
      "On iPhone, use Share, then Add to Home Screen.",
    ],
  },
  {
    id: "2026-11-14-rename-group",
    date: "2026-11-14",
    title: "Rename a group",
    bullets: [
      "You can rename a group from the You tab. Anyone in the group can do it.",
      "The new name shows up for everyone in the group.",
    ],
  },
  {
    id: "2026-11-14-logo",
    date: "2026-11-14",
    title: "A new logo",
    bullets: [
      "Loan some has a wordmark now. The o is a teal circular arrow, like something lent and returned.",
      "The app icon uses the same arrow.",
    ],
  },
  {
    id: "2026-11-14-loan-some",
    date: "2026-11-14",
    title: "We are now Loan some",
    bullets: [
      "The app used to be called Loaner. It is now Loan some.",
      "Everything else works the same.",
    ],
  },
  {
    id: "2026-11-14-photo-never-stuck",
    date: "2026-11-14",
    title: "Photos no longer get stuck",
    bullets: [
      "If Loaner cannot name your photo within about 15 seconds, the form opens anyway.",
      "Your photo stays attached. Type the name, or let it fill in if it finishes.",
      "Type it in now works while Loaner is looking at the photo.",
    ],
  },
  {
    id: "2026-11-14-camera-add",
    date: "2026-11-14",
    title: "Add an item with the camera",
    bullets: [
      "Add an item now opens the camera. Snap a photo, or pick one from your gallery.",
      "Loaner suggests a name and category on your phone. You can change both.",
      "Prefer typing? Tap Type it in. Items now have a category too.",
    ],
  },
  {
    id: "2026-11-14-send-feedback",
    date: "2026-11-14",
    title: "Send feedback",
    bullets: [
      "Got an idea or hit a bug? Tap Send feedback on the You tab.",
      "Write a message, and add a photo or screenshot if it helps.",
      "Your name is sent with it, so we know who to thank.",
    ],
  },
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
