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

/**
 * One tab bar for the whole session. It lives on body (not in #root, which each screen replaces), is added
 * when the main app shows and removed on the sign-in screens. update() moves the highlight and the badge in place.
 */
const bar = AppKit.tabbar({
  tabs: TABS.map(([id, label]) => ({ id, label, icon: icon(id) })),
  active: currentTab,
  onSelect: (id) => go(`#/${id}`),
  label: "Main",
  badgeLabel: "unread",
});

function updateBar(active = currentTab) {
  currentTab = active;
  bar.update({ active, badge: { alerts: state.unread > 0 ? state.unread : 0 } });
}

function showBar(active) {
  if (!bar.el.isConnected) document.body.append(bar.el);
  updateBar(active);
}

const ROUTES = [
  [/^#\/browse$/, "browse", () => renderBrowse()],
  [/^#\/item\/([^/]+)\/messages\/([^/]+)$/, "browse", (m) => renderMessages(m[1], m[2])],
  [/^#\/item\/([^/]+)\/messages$/, "browse", (m) => renderMessages(m[1], null)],
  [/^#\/item\/([^/]+)$/, "browse", (m) => renderItem(m[1])],
  [/^#\/mine$/, "mine", () => renderMine()],
  [/^#\/mine\/new$/, "mine", () => renderCamera()],
  [/^#\/mine\/new\/form$/, "mine", () => renderItemForm(null)],
  [/^#\/mine\/edit\/([^/]+)$/, "mine", (m) => renderItemForm(m[1])],
  [/^#\/requests$/, "requests", () => renderRequests()],
  [/^#\/alerts$/, "alerts", () => renderAlerts()],
  [/^#\/you$/, "you", () => renderYou()],
];

let serial = 0;

async function show() {
  const mine = ++serial;
  // The pages behind the links in our emails. They work with or without a session on this phone.
  const linkKind = linkKindFromPath();
  if (linkKind) {
    bar.el.remove();
    root.replaceChildren(renderLinkPage(linkKind));
    return;
  }
  if (!getToken() || /^\/join\//.test(location.pathname)) {
    bar.el.remove();
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
    root.replaceChildren(renderAddEmail(show));
    return;
  }
  const hash = location.hash || "#/browse";
  const found = ROUTES.map(([pattern, tab, view]) => [pattern.exec(hash), tab, view]).find(([match]) => match);
  if (!found) {
    location.replace("#/browse");
    return;
  }
  const [match, tab, view] = found;
  stopCamera();
  root.replaceChildren(h("main", { class: "page" }, h("div", { class: "spinner" }, "Loading...")));
  showBar(tab);
  let screen;
  try {
    screen = await view(match);
  } catch (error) {
    screen = h("div", null, h("p", { class: "error-text", role: "alert" }, error.message || "Something went wrong"), h("button", { onclick: show }, "Try again"));
  }
  if (mine !== serial) return;
  root.replaceChildren(h("main", { class: "page" }, confirmBanner(), screen));
  updateBar(tab);
  window.scrollTo(0, 0);
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

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => toast("Offline mode is not available here", "error"));
}

show();
