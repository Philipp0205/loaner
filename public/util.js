/** Small DOM helper: h("div", { class: "x", onclick }, child, "text"). Text is never parsed as HTML. */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === false || value === null || value === undefined) continue;
    if (key === "class") el.className = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key === "value" || key === "checked" || key === "disabled") el[key] = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  add(el, children);
  return el;
}

/** The "Loan some" wordmark as a heading. The heading carries the name, the image is decoration. */
export function wordmarkHeading() {
  return h("h1", { class: "wordmark-heading", "aria-label": "Loan some" },
    h("img", { class: "wordmark", src: "/logo.svg", alt: "", draggable: "false" }));
}

function add(el, children) {
  for (const child of children) {
    if (Array.isArray(child)) add(el, child);
    else if (child === null || child === undefined || child === false) continue;
    else el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/**
 * The glass navbar and the large title for a tab root. The h1 carries the name for assistive tech, the navbar
 * copy is decoration. app.js hooks AppKit.largeTitle onto the h1 once the screen is mounted.
 * `actions` sit on the right of the large title (a button, a switcher).
 */
export function largeTitleHead(title, ...actions) {
  return h("div", { class: "native-head" },
    h("header", { class: "ak-navbar" }, h("span", { class: "ak-navbar-title", "aria-hidden": "true" }, title)),
    h("div", { class: "native-title-row" }, h("h1", { class: "ak-large-title" }, title), actions.length ? h("div", { class: "native-title-actions" }, actions) : null));
}

/** Grey placeholder shapes while a list loads. `kind` is "tile" (browse grid) or "card" (a list of cards). */
export function skeletonList(kind, count = 4) {
  const shape = () => h("div", { class: `skel-${kind}`, "aria-hidden": "true" },
    h("div", { class: "ak-skeleton skel-pic" }),
    h("div", { class: "ak-skeleton skel-line" }),
    h("div", { class: "ak-skeleton skel-line short" }));
  return h("div", { class: kind === "tile" ? "grid" : "skel-stack" },
    Array.from({ length: count }, shape));
}

/**
 * Shows `data` for a list right away from the saved copy (AppKit.swr), then replaces it with fresh data.
 * `mount` is the container that holds the list, `draw(data)` returns the nodes. With nothing saved the
 * container shows skeleton shapes while the first fetch runs, and a message with a "Try again" button if it fails.
 */
export function swrList(mount, key, fetcher, draw, skeleton) {
  const run = () => {
    // Pull to refresh waits on these (see listsSettled), so its spinner lasts until the list is fresh.
    const settle = (promise) => {
      const tracked = promise.catch(() => {});
      loading.add(tracked);
      tracked.then(() => loading.delete(tracked));
    };
    let drawn = false;
    // A saved copy renders synchronously inside swr(), so the skeleton never flashes when there is one.
    mount.replaceChildren(skeleton());
    mount.setAttribute("aria-busy", "true");
    const fail = (error) => {
      // With a saved copy on screen, a failed refresh just leaves it there.
      if (drawn) return;
      mount.replaceChildren(h("div", null,
        h("p", { class: "error-text", role: "alert" }, error.message || "Something went wrong"),
        h("button", { type: "button", onclick: run }, "Try again")));
      mount.removeAttribute("aria-busy");
    };
    settle(window.AppKit.swr(key, fetcher, (data) => {
      drawn = true;
      mount.replaceChildren(...[].concat(draw(data)));
      mount.removeAttribute("aria-busy");
    }, { onError: fail }));
  };
  run();
}

/** The list loads that swrList has started and not finished yet. */
const loading = new Set();

/** Resolves once every list that is loading has its fresh data (or has failed). Never rejects. */
export const listsSettled = () => Promise.allSettled([...loading]);

/** A short message at the bottom of the screen (the kit's AppKit.toast). `kind` is "info" or "error". */
export function toast(message, kind = "info") {
  window.AppKit.toast(message, { kind });
}

/** "7 Jun" from "2026-06-07". */
export function fmtDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function fmtRange(from, until) {
  return from === until ? fmtDate(from) : `${fmtDate(from)} to ${fmtDate(until)}`;
}

/** A moment (ms) as "7 Jun". */
export function fmtMoment(ms) {
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

const wholeEuros = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const euros = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A suggested amount as euros: 5 is "€5", 12.5 is "€12.50". Display only, the app never handles money. */
export function fmtAmount(amount) {
  return (Number.isInteger(amount) ? wholeEuros : euros).format(amount);
}

/** The number alone, as typed into the item form: 5 is "5", 12.5 is "12.50". */
export function fmtAmountPlain(amount) {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

export function statusText(item) {
  if (item.status === "lent") return `Lent to ${item.lent.to.name} until ${fmtDate(item.lent.until)}`;
  return item.status === "paused" ? "Paused" : "Available";
}

/** `short` drops the borrower's name, so the pill fits on one line in a browse tile. */
export function statusPill(item, short = false) {
  const late = item.status === "lent" && item.lent.late;
  let text = statusText(item) + (late ? " (overdue)" : "");
  if (short && item.status === "lent") text = late ? `Overdue, due ${fmtDate(item.lent.until)}` : `Lent until ${fmtDate(item.lent.until)}`;
  return h("span", { class: `pill ${late ? "late" : item.status}` }, text);
}

/** Copies text (the kit's AppKit.copyText, which falls back to a hidden textarea). Resolves true or false. */
export function copyText(text) {
  return window.AppKit.copyText(text);
}

/** Runs fn with the button disabled, and shows any error as a toast. */
export async function busy(button, fn) {
  button.disabled = true;
  try {
    return await fn();
  } catch (error) {
    toast(error.message || "Something went wrong", "error");
    return undefined;
  } finally {
    button.disabled = false;
  }
}

export function emptyState(title, text, ...extra) {
  return h("div", { class: "empty" }, h("h2", null, title), h("p", null, text), ...extra);
}
