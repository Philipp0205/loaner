import { h } from "./util.js";
import { icon } from "./icons.js";

/** sessionStorage key: set when the person closes the prompt, so it only stays away for this visit. */
export const DISMISS_KEY = "loaner_install_prompt_dismissed";

const BANNER_ID = "install-prompt";

/** True when the app is running as an installed PWA (standalone display mode, or iOS home screen). */
export function isStandalone(win) {
  try {
    if (win?.navigator?.standalone === true) return true;
    return !!win?.matchMedia?.("(display-mode: standalone)")?.matches;
  } catch {
    return false;
  }
}

/** iPhone, iPod and iPad. Newer iPads send a Macintosh UA, so they are told apart by touch points. */
export function isIos(win) {
  const nav = win?.navigator;
  if (!nav) return false;
  const ua = String(nav.userAgent || "");
  if (/iPhone|iPod|iPad/.test(ua)) return true;
  return /Macintosh/.test(ua) && (nav.maxTouchPoints || 0) > 1;
}

/** Reads the session flag. Uses sessionStorage only, never localStorage. */
export function isDismissed(win) {
  try {
    return win.sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function setDismissed(win) {
  try {
    win.sessionStorage.setItem(DISMISS_KEY, "1");
  } catch {
    /* storage can be blocked, the in-memory flag still hides it for this page */
  }
}

/** "ios" for Share steps, "install" when a captured beforeinstallprompt can be used, else "generic". */
export function pickVariant(win, deferred) {
  if (isIos(win)) return "ios";
  if (deferred && typeof deferred.prompt === "function") return "install";
  return "generic";
}

/** Whether the prompt may be on screen: not installed, not closed this session, no appinstalled yet. */
export function shouldShow(win, installedThisPage = false) {
  return !installedThisPage && !isStandalone(win) && !isDismissed(win);
}

// Page-lifetime state. The beforeinstallprompt event can fire before the first render, so it is kept here.
const state = { deferred: null, hidden: false };

function onBeforeInstallPrompt(event) {
  event.preventDefault();
  state.deferred = event;
  refresh();
}

function onAppInstalled() {
  state.deferred = null;
  hideForSession();
}

/** Starts listening for the install events. Runs at module load in a browser, never in node. */
export function listen(win) {
  win.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  win.addEventListener("appinstalled", onAppInstalled);
}

if (typeof window !== "undefined") listen(window);

function hideForSession() {
  state.hidden = true;
  setDismissed(window);
  document.getElementById(BANNER_ID)?.remove();
}

async function install(button) {
  const event = state.deferred;
  if (!event) return;
  // The event works once. If it is not accepted, the banner falls back to the menu hint.
  state.deferred = null;
  button.disabled = true;
  try {
    await event.prompt();
    const choice = await event.userChoice;
    if (choice?.outcome === "accepted") {
      hideForSession();
      return;
    }
  } catch {
    /* the browser refused to show it, the hint below still helps */
  }
  refresh();
}

function steps() {
  return h("ol", { class: "ip-steps" },
    h("li", null, "Tap Share ", icon("share"), h("span", { class: "sr-only" }, "(the square with an arrow)")),
    h("li", null, "Then tap Add to Home Screen"),
  );
}

function controls(variant) {
  if (variant === "install") {
    const button = h("button", { type: "button", class: "ip-install" }, "Install");
    button.addEventListener("click", () => install(button));
    return button;
  }
  if (variant === "ios") return steps();
  return h("p", { class: "ip-hint" }, "Open your browser menu and choose Install or Add to Home screen.");
}

function fill(banner) {
  const variant = pickVariant(window, state.deferred);
  banner.dataset.variant = variant;
  banner.replaceChildren(
    h("img", { class: "ip-mark", src: "/icons/icon-192.png", alt: "", width: "40", height: "40" }),
    h("div", { class: "ip-body" },
      h("p", { class: "ip-title" }, "Install Loan some"),
      h("p", { class: "ip-text" }, "Add it to your home screen so it is easy to open."),
      controls(variant),
    ),
    h("button", { type: "button", class: "ip-close", "aria-label": "Not now", onclick: hideForSession }, icon("close")),
  );
}

/** Redraws the banner if it is on screen, for example when beforeinstallprompt arrives late. */
function refresh() {
  const banner = document.getElementById(BANNER_ID);
  if (banner) fill(banner);
}

/**
 * Call after a screen is drawn. Puts one banner at the top of the page (on body, so the
 * router never wipes it), or removes it when it should not show. Safe to call again and again.
 */
export function considerInstallPrompt() {
  const existing = document.getElementById(BANNER_ID);
  if (state.hidden || !shouldShow(window)) {
    existing?.remove();
    return;
  }
  if (existing) return;
  const banner = h("section", { id: BANNER_ID, role: "region", "aria-label": "Install Loan some" });
  fill(banner);
  document.body.prepend(banner);
}
