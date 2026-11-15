/**
 * Keeps <meta name="theme-color"> equal to the page background, so the Android status bar
 * matches the page instead of the teal accent. Pure helpers take their inputs, so node can load this file.
 */

const RGB = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*(?:,\s*(\d+(?:\.\d+)?)\s*)?\)$/;

/**
 * Turns a computed CSS colour such as "rgb(15, 28, 31)" into "#0f1c1f".
 * Returns null for transparent or anything it does not recognise.
 */
export function rgbToHex(value) {
  const match = RGB.exec(String(value ?? "").trim());
  if (!match) return null;
  if (match[4] !== undefined && Number(match[4]) === 0) return null;
  return `#${[match[1], match[2], match[3]].map((part) => Math.round(Number(part)).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The colour the page is painted with: html first (it carries --bg), then body.
 * Returns null when neither has a solid colour.
 */
export function pageBackground(doc = document, win = window) {
  for (const element of [doc.documentElement, doc.body]) {
    if (!element) continue;
    const hex = rgbToHex(win.getComputedStyle(element).backgroundColor);
    if (hex) return hex;
  }
  return null;
}

/** Writes the painted page background into the theme-color meta. Keeps the old value if none is found. */
export function applyThemeColor(doc = document, win = window) {
  const meta = doc.querySelector('meta[name="theme-color"]');
  const hex = pageBackground(doc, win);
  if (meta && hex) meta.setAttribute("content", hex);
  return hex;
}

/** Sets the meta now, and again whenever the phone switches between light and dark. */
export function watchThemeColor(doc = document, win = window) {
  applyThemeColor(doc, win);
  const query = win.matchMedia?.("(prefers-color-scheme: dark)");
  query?.addEventListener?.("change", () => applyThemeColor(doc, win));
}
