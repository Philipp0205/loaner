import { api, getToken } from "./api.js";
import { renderGate } from "./gate.js";
import { confirmBanner, emailCard, linkKindFromPath, renderAddEmail, renderLinkPage } from "./email.js";
import { renderBrowse, renderItem } from "./browse.js";
import { renderMine, renderItemForm } from "./mine.js";
import { renderCamera, stopCamera } from "./camera.js";
import { renderRequests } from "./requests.js";
import { renderMessages } from "./messages.js";
import { renderAlerts } from "./alerts.js";
import { renderYou } from "./you.js";
import { go, loadGroups, loadMe, redraw, state } from "./state.js";
import { h, toast } from "./util.js";
import { icon } from "./icons.js";
import { considerWhatsNew } from "./whats-new-ui.js";

const { AppKit } = window;

AppKit.themeColor.start();
AppKit.installPrompt.init({
  appName: "Loan some",
  iconUrl: "/icons/icon-192.png",
  title: "Install Loan some",
  text: "Add it to your home screen so it is easy to open.",
  closeLabel: "Not now",
  iosNonSafari: "share-steps",
});

const root = document.getElementById("root");

const TABS = [
  ["browse", "Browse"],
  ["mine", "My items"],
  ["requests", "Requests"],
  ["alerts", "Alerts"],
  ["you", "You"],
];

let currentTab = "browse";
// Set by a tab tap, so the next screen change is a plain switch with no slide.
let tappedTab = false;

/**
 * One tab bar for the whole session. It lives on body (not in #root, which each screen replaces), is added
 * when the main app shows and removed on the sign-in screens. update() moves the highlight and the badge in place.
 * The bar remembers each tab's scroll position, and a second tap on the active tab scrolls it to the top, or
 * returns a tab that is deeper in (an item, a form) to its root.
 */
const bar = AppKit.tabbar({
  tabs: TABS.map(([id, label]) => ({ id, label, icon: icon(id) })),
  active: currentTab,
  onSelect: (id) => {
    // A tap on the active tab still runs go(), which redraws it (the retap refresh).
    if (id !== currentTab) tappedTab = true;
    go(`#/${id}`);
  },
  onReselect: (id) => {
    if ((location.hash || "#/browse") !== `#/${id}`) go(`#/${id}`);
  },
  scrollTopOnReselect: true,
  rememberScroll: true,
  label: "Main",
  badgeLabel: "unread",
});

function updateBar(active = currentTab) {
  currentTab = active;
  bar.update({ active, badge: { alerts: state.unread > 0 ? state.unread : 0 } });
}

/** Puts the bar on screen. The highlight moves later, once the new screen is drawn, so the scroll restore finds it. */
function showBar() {
  if (!bar.el.isConnected) document.body.append(bar.el);
  updateBar(currentTab);
}

// The fourth item is how deep the screen sits in its tab: 0 is a tab root. A deeper screen pushes, a shallower one pops.
const ROUTES = [
  [/^#\/browse$/, "browse", () => renderBrowse(), 0],
  [/^#\/item\/([^/]+)\/messages\/([^/]+)$/, "browse", (m) => renderMessages(m[1], m[2]), 2],
  [/^#\/item\/([^/]+)\/messages$/, "browse", (m) => renderMessages(m[1], null), 2],
  [/^#\/item\/([^/]+)$/, "browse", (m) => renderItem(m[1]), 1],
  [/^#\/mine$/, "mine", () => renderMine(), 0],
  [/^#\/mine\/new$/, "mine", () => renderCamera(), 1],
  [/^#\/mine\/new\/form$/, "mine", () => renderItemForm(null), 2],
  [/^#\/mine\/edit\/([^/]+)$/, "mine", (m) => renderItemForm(m[1]), 1],
  [/^#\/requests$/, "requests", () => renderRequests(), 0],
  [/^#\/alerts$/, "alerts", () => renderAlerts(), 0],
  [/^#\/you$/, "you", () => renderYou(), 0],
];

let serial = 0;
let lastDepth = null;
let titleHandle = null;
let swipeHandle = null;

function dropNativeParts() {
  titleHandle?.destroy();
  titleHandle = null;
  swipeHandle?.destroy();
  swipeHandle = null;
  lastDepth = null;
}

/** Edge swipe back, only while a screen is deeper than its tab root. It does nothing outside an installed app. */
function setSwipe(depth, tab) {
  if (depth > 0 && !swipeHandle) {
    swipeHandle = AppKit.transition.swipeBack({ onBack: () => (history.length > 1 ? history.back() : go(`#/${tab}`)) });
  } else if (depth === 0 && swipeHandle) {
    swipeHandle.destroy();
    swipeHandle = null;
  }
}

function directionFor(depth, tapped) {
  if (lastDepth === null || tapped || depth === lastDepth) return "none";
  return depth > lastDepth ? "push" : "pop";
}

async function show() {
  const mine = ++serial;
  // The pages behind the links in our emails. They work with or without a session on this phone.
  const linkKind = linkKindFromPath();
  if (linkKind) {
    bar.el.remove();
    dropNativeParts();
    root.replaceChildren(renderLinkPage(linkKind));
    return;
  }
  if (!getToken() || /^\/join\//.test(location.pathname)) {
    bar.el.remove();
    dropNativeParts();
    root.replaceChildren(await renderGate());
    return;
  }
  try {
    if (!state.user) {
      await loadMe();
      if (!state.user.needsEmail) await loadGroups();
    }
  } catch (error) {
    if (error.status !== 401) root.replaceChildren(h("main", { class: "page" }, h("p", { class: "error-text" }, error.message), h("button", { onclick: () => location.reload() }, "Try again")));
    return;
  }
  // An account from before email was required adds one first. Nothing else loads until it has.
  if (state.user.needsEmail) {
    bar.el.remove();
    dropNativeParts();
    root.replaceChildren(renderAddEmail(show));
    return;
  }
  const hash = location.hash || "#/browse";
  const found = ROUTES.map(([pattern, tab, view, depth]) => [pattern.exec(hash), tab, view, depth]).find(([match]) => match);
  if (!found) {
    location.replace("#/browse");
    return;
  }
  const [match, tab, view, depth] = found;
  stopCamera();
  const tapped = tappedTab;
  tappedTab = false;
  const direction = directionFor(depth, tapped);
  // The old screen stays up while the next one loads. Only a first paint shows the spinner.
  if (!root.querySelector(".ak-screen")) {
    root.replaceChildren(h("main", { class: "page" }, h("div", { class: "spinner" }, "Loading...")));
  }
  showBar();
  let screen;
  try {
    screen = await view(match);
  } catch (error) {
    screen = h("div", null, h("p", { class: "error-text", role: "alert" }, error.message || "Something went wrong"), h("button", { onclick: show }, "Try again"));
  }
  if (mine !== serial) return;
  await AppKit.transition.go(() => {
    if (mine !== serial) return;
    titleHandle?.destroy();
    titleHandle = null;
    root.replaceChildren(h("main", { class: "page ak-screen" }, confirmBanner(), screen));
    // Moving the highlight restores the scroll the tab had, for a tab tap. Anything else starts at the top.
    updateBar(tab);
    if (!tapped) window.scrollTo(0, 0);
    const title = root.querySelector(".ak-large-title");
    if (title) titleHandle = AppKit.largeTitle(title, { navbar: root.querySelector(".ak-navbar") });
    lastDepth = depth;
    setSwipe(depth, tab);
  }, { direction });
  if (mine !== serial) return;
  considerWhatsNew();
}

/**
 * One GET /api/me keeps the unread badge fresh and notices when the address was confirmed elsewhere,
 * without redrawing the screen. Skipped while the page is hidden.
 */
async function pollUnread() {
  if (!getToken() || !state.user || document.hidden) return;
  try {
    const me = await api("GET", "/api/me");
    if (me.unread !== state.unread) {
      state.unread = me.unread;
      updateBar();
    }
    if (me.user.emailVerifiedAt && state.user && !state.user.emailVerifiedAt) {
      state.user = me.user;
      showConfirmed();
    }
  } catch {
    /* a missed poll is fine */
  }
}

/** The address was just confirmed: drop the banner and refresh the You tab email card in place, with no reload. */
function showConfirmed() {
  const banner = document.getElementById("confirm-banner");
  if (banner) banner.remove();
  const card = document.getElementById("email-card");
  if (card) card.replaceWith(emailCard(() => redraw("#/you")));
}

const waitingForConfirm = () => !!state.user && !!state.user.email && !state.user.emailVerifiedAt;

window.addEventListener("hashchange", show);
setInterval(pollUnread, 30_000);
// A lighter check while the banner is up, so confirming on another phone shows here within seconds.
setInterval(() => waitingForConfirm() && pollUnread(), 6_000);
document.addEventListener("visibilitychange", pollUnread);
window.addEventListener("focus", pollUnread);

/**
 * A new worker is installed and waiting. The bar stays until the person taps Reload, which swaps the worker
 * and reloads once. Nothing reloads by itself, so a half-filled form is never lost.
 */
function offerUpdate(update) {
  if (document.getElementById("sw-update")) return;
  const reload = h("button", { type: "button", class: "primary", onclick: () => update.apply() }, "Reload");
  document.body.append(h("div", { id: "sw-update", class: "sw-update", role: "status" }, h("span", null, "A new version is ready"), reload));
}

if ("serviceWorker" in navigator) {
  AppKit.sw.register({ url: "/sw.js", onUpdate: offerUpdate }).then((registration) => {
    if (!registration) toast("Offline mode is not available here", "error");
  });
}

show();
