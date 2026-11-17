import { normalizeEntries } from "./whats-new.js";

/**
 * What's new entries, newest first. Add new ones at the top.
 * id: lowercase letters, digits and dashes. date: YYYY-MM-DD. Keep copy short and plain.
 * @type {import("./whats-new.js").Entry[]}
 */
const RAW = [
  {
    id: "2026-11-17-native-feel",
    date: "2026-11-17",
    title: "Feels more like an app",
    bullets: [
      "Screens slide in and out, and you can swipe back from the left edge once the app is installed.",
      "Lists show right away from the last visit, then update. Tap the tab you are on to jump back to the top.",
      "When a new version is ready you get a bar with a Reload button.",
    ],
  },
  {
    id: "2026-11-16-app-kit-v041",
    date: "2026-11-16",
    title: "Sign up with your email, and a Donate button",
    bullets: [
      "New accounts add an email and confirm it with a link. It also lets you get back in if you lose your recovery code.",
      "If you joined before, the app asks for your email once.",
      "The You tab has an optional Donate button. It only opens a PayPal link.",
    ],
  },
  {
    id: "2026-11-16-item-added",
    date: "2026-11-16",
    title: "Get an alert when a friend adds an item",
    bullets: [
      "When someone in your group adds an item, you get an alert and a push if you have them on.",
      "Tap Open on the alert to see the item.",
    ],
  },
  {
    id: "2026-11-15-photo-fullscreen",
    date: "2026-11-15",
    title: "Tap an item photo to see it full screen",
    bullets: [
      "On an item page, tap the photo to see all of it on a dark background.",
      "Close it with the X, a tap outside the photo, or the Back button.",
    ],
  },
  {
    id: "2026-11-15-welcome",
    date: "2026-11-15",
    title: "A home page you can always open",
    bullets: [
      "The /welcome link always opens the home page, even when you are signed in.",
      "The home page now shows the app with real item photos, and a second screenshot of a shelf.",
    ],
  },
  {
    id: "2026-11-15-landing",
    date: "2026-11-15",
    title: "A short home page for new visitors",
    bullets: [
      "People who are not signed in now see a short home page that explains Loan some.",
      "Once you sign in, or open the installed app, it works as before.",
    ],
  },
  {
    id: "2026-11-15-app-kit-v030",
    date: "2026-11-15",
    title: "Easier to read, and a fix for iPhone Chrome",
    bullets: [
      "Grey text, red warnings and the error pop-up are easier to read in light and dark mode.",
      "On iPhone Chrome, the install prompt shows the Share steps again.",
      "Sheets still sit above the tab bar, so Done and Send always work.",
    ],
  },
  {
    id: "2026-11-15-notification-tap",
    date: "2026-11-15",
    title: "Notifications open the right screen",
    bullets: [
      "Tapping a notification now takes you to the right screen, even if the app is already open.",
      "Sign-up and recovery limits are now counted per person, and notification setup is more reliable.",
    ],
  },
  {
    id: "2026-11-15-app-kit",
    date: "2026-11-15",
    title: "A shared look",
    bullets: [
      "Loan some now shares its buttons, sheets and tab bar with our other apps.",
      "Colours are crisper in dark and light mode, and the phone's Back button closes a sheet.",
    ],
  },
  {
    id: "2026-11-15-status-bar",
    date: "2026-11-15",
    title: "Status bar matches the page",
    bullets: [
      "The installed app's status bar now matches the page, not the teal accent.",
      "If it still looks teal, reinstall the app.",
    ],
  },
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
