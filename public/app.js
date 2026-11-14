import { api, getToken } from "./api.js";
import { renderGate } from "./gate.js";
import { renderBrowse, renderItem } from "./browse.js";
import { renderMine, renderItemForm } from "./mine.js";
import { renderCamera, stopCamera } from "./camera.js";
import { renderRequests } from "./requests.js";
import { renderAlerts } from "./alerts.js";
import { renderYou } from "./you.js";
import { go, loadGroups, loadMe, state } from "./state.js";
import { h, toast } from "./util.js";
import { icon } from "./icons.js";
import { considerWhatsNew } from "./whats-new-ui.js";

const root = document.getElementById("root");

const TABS = [
  ["browse", "Browse"],
  ["mine", "My items"],
  ["requests", "Requests"],
  ["alerts", "Alerts"],
  ["you", "You"],
];

const ROUTES = [
  [/^#\/browse$/, "browse", () => renderBrowse()],
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
  if (!getToken() || /^\/join\//.test(location.pathname)) {
    root.replaceChildren(await renderGate());
    return;
  }
  try {
    if (!state.user) {
      await loadMe();
      await loadGroups();
    }
  } catch (error) {
    if (error.status !== 401) root.replaceChildren(h("main", { class: "page" }, h("p", { class: "error-text" }, error.message), h("button", { onclick: () => location.reload() }, "Try again")));
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
  root.replaceChildren(h("main", { class: "page" }, h("div", { class: "spinner" }, "Loading...")), tabbar(tab));
  let screen;
  try {
    screen = await view(match);
  } catch (error) {
    screen = h("div", null, h("p", { class: "error-text", role: "alert" }, error.message || "Something went wrong"), h("button", { onclick: show }, "Try again"));
  }
  if (mine !== serial) return;
  root.replaceChildren(h("main", { class: "page" }, screen), tabbar(tab));
  window.scrollTo(0, 0);
  considerWhatsNew();
}

function tabbar(active) {
  return h(
    "nav",
    { class: "tabbar", "aria-label": "Main" },
    TABS.map(([id, label]) =>
      h("button", { type: "button", "data-tab": id, "aria-current": id === active ? "page" : false, onclick: () => go(`#/${id}`) },
        icon(id),
        h("span", null, label),
        id === "alerts" && state.unread > 0 ? h("span", { class: "badge", "aria-label": `${state.unread} unread` }, state.unread > 99 ? "99+" : state.unread) : null,
      ),
    ),
  );
}

/** Keeps the unread badge fresh without redrawing the screen. */
async function pollUnread() {
  if (!getToken() || !state.user || document.hidden) return;
  try {
    const me = await api("GET", "/api/me");
    if (me.unread !== state.unread) {
      state.unread = me.unread;
      const bar = document.querySelector(".tabbar");
      if (bar) bar.replaceWith(tabbar(document.querySelector(".tabbar [aria-current]")?.dataset.tab));
    }
  } catch {
    /* a missed poll is fine */
  }
}

window.addEventListener("hashchange", show);
setInterval(pollUnread, 30_000);
document.addEventListener("visibilitychange", pollUnread);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => toast("Offline mode is not available here", "error"));
}

show();
