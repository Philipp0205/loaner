/**
 * What's new: pure helpers over the changelog in changelog.js. No DOM, no storage.
 * Entries are newest first. The seen id is the newest entry the person has already seen.
 *
 * @typedef {{ id: string, date: string, title: string, bullets: string[] }} Entry
 */

export const SEEN_KEY = "loaner_whats_new_seen";

const ID_RE = /^[a-z0-9-]{1,64}$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function validId(id) {
  return typeof id === "string" && ID_RE.test(id);
}

/**
 * Only well-formed entries survive, so a bad edit to the changelog cannot break the app.
 * A repeated id keeps its first entry.
 * @returns {Entry[]}
 */
export function normalizeEntries(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const kept = [];
  for (const entry of raw) {
    const ok =
      entry &&
      validId(entry.id) &&
      !seen.has(entry.id) &&
      typeof entry.title === "string" && entry.title.trim() &&
      typeof entry.date === "string" && entry.date.trim() &&
      Array.isArray(entry.bullets) && entry.bullets.length > 0 &&
      entry.bullets.every((bullet) => typeof bullet === "string" && bullet.trim());
    if (!ok) continue;
    seen.add(entry.id);
    kept.push({ id: entry.id, date: entry.date, title: entry.title, bullets: entry.bullets.slice() });
  }
  return kept;
}

export function latestId(entries) {
  return entries?.[0]?.id ?? null;
}

/**
 * Entries the person has not seen yet.
 * Nothing seen: all of them. An id this build does not know (a newer release): none.
 */
export function unseenEntries(entries, seenId) {
  if (!Array.isArray(entries) || !entries.length) return [];
  if (!seenId) return entries.slice();
  const index = entries.findIndex((entry) => entry.id === seenId);
  if (index < 0) return [];
  return entries.slice(0, index);
}

/** "2026-11-14" becomes "14 Nov 2026". Anything else is shown as written. */
export function formatEntryDate(date) {
  const match = DATE_RE.exec(String(date || ""));
  if (!match) return String(date || "");
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return String(date);
  return `${Number(match[3])} ${month} ${match[1]}`;
}
