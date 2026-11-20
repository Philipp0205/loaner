import { MAX_PHOTOS } from "./limits.js";

/** How many more photos fit, never below 0. */
export function slotsLeft(have, max = MAX_PHOTOS) {
  return Math.max(0, max - have);
}

/** The files that fit, in order, and how many were left out. */
export function limitFiles(files, have, max = MAX_PHOTOS) {
  const list = Array.from(files);
  const room = slotsLeft(have, max);
  return { kept: list.slice(0, room), dropped: Math.max(0, list.length - room) };
}

/** Which slide a horizontally scrolled track is showing. Safe for a width of 0 and for a bounce past either end. */
export function indexFromScroll(scrollLeft, width, count) {
  if (!(width > 0) || count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(scrollLeft / width)));
}

/** The index after a key press in the viewer, or null when the key does nothing. Stops at both ends. */
export function indexAfterKey(key, index, count) {
  if (key === "ArrowRight") return Math.min(count - 1, index + 1);
  if (key === "ArrowLeft") return Math.max(0, index - 1);
  return null;
}
