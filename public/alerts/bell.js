import { icon } from "../icons.js";
import { badgeText, unreadLabel } from "../chat/copy.js";
import { go, state } from "../state.js";
import { h, largeTitleHead } from "../util.js";
import { ALERTS_COPY, bellLabel } from "./copy.js";
import { rememberReturn } from "./return.js";

/** Opens Alerts and remembers the tab it was opened from. */
function openAlerts() {
  rememberReturn(location.hash || "#/browse");
  go("#/alerts");
}

/** Sets the bell's name and its unread badge. No badge at 0. */
export function paintBell(button, count) {
  button.querySelector(".bell-badge")?.remove();
  button.setAttribute("aria-label", bellLabel(count));
  if (count > 0) button.append(h("span", { class: "ak-badge bell-badge", role: "img", "aria-label": unreadLabel(count) }, badgeText(count)));
}

/** The bell for the top right of a main tab. Unread count is state.unread. */
export function alertsBell() {
  const button = h("button", { type: "button", class: "icon-btn bell", "data-alerts-bell": "", onclick: openAlerts }, icon("alerts"));
  paintBell(button, state.unread);
  return button;
}

/** Brings every bell on screen up to date after the unread count changed. */
export function syncBells(count) {
  document.querySelectorAll("[data-alerts-bell]").forEach((button) => paintBell(button, count));
}

/** The large title row of a main tab: the title, its own actions, then the bell at the far right. */
export function tabHead(title, ...actions) {
  return largeTitleHead(title, ...actions, alertsBell());
}
