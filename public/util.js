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

function add(el, children) {
  for (const child of children) {
    if (Array.isArray(child)) add(el, child);
    else if (child === null || child === undefined || child === false) continue;
    else el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function toast(message, kind = "info") {
  const box = document.getElementById("toasts");
  const el = h("div", { class: `toast ${kind}`, role: kind === "error" ? "alert" : "status" }, message);
  box.append(el);
  setTimeout(() => el.remove(), kind === "error" ? 5000 : 2800);
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

export function fmtAmount(amount) {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

export function statusText(item) {
  if (item.status === "lent") return `Lent to ${item.lent.to.name} until ${fmtDate(item.lent.until)}`;
  return item.status === "paused" ? "Paused" : "Available";
}

export function statusPill(item) {
  const cls = item.status === "lent" && item.lent.late ? "late" : item.status;
  return h("span", { class: `pill ${cls}` }, statusText(item), item.status === "lent" && item.lent.late ? " (overdue)" : "");
}

/** Copies text. Falls back to a hidden textarea where the clipboard API is blocked. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = h("textarea", { "aria-hidden": "true", readonly: true });
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    let done = false;
    try {
      done = document.execCommand("copy");
    } catch {
      done = false;
    }
    area.remove();
    return done;
  }
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
