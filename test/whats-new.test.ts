import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

type Entry = { id: string; date: string; title: string; bullets: string[] };
type Helpers = {
  SEEN_KEY: string;
  validId: (id: unknown) => boolean;
  normalizeEntries: (raw: unknown) => Entry[];
  latestId: (entries: Entry[] | null) => string | null;
  unseenEntries: (entries: Entry[] | null, seenId: string | null) => Entry[];
  formatEntryDate: (date: unknown) => string;
};

// Both files are plain JS with no DOM use at import time, so node can load them directly.
const { SEEN_KEY, validId, normalizeEntries, latestId, unseenEntries, formatEntryDate } = (await import(
  new URL("../public/whats-new.js", import.meta.url).href
)) as Helpers;
const { CHANGELOG } = (await import(new URL("../public/changelog.js", import.meta.url).href)) as { CHANGELOG: Entry[] };

const entry = (id: string): Entry => ({ id, date: "2026-11-14", title: id, bullets: ["one", "two"] });
const LIST = [entry("c"), entry("b"), entry("a")];
const ids = (list: Entry[]) => list.map((item) => item.id);

test("the seen key is namespaced for Loaner", () => {
  assert.equal(SEEN_KEY, "loaner_whats_new_seen");
});

test("normalizeEntries keeps good entries and drops broken ones", () => {
  const kept = normalizeEntries([
    entry("ok"),
    { id: "Bad Id", date: "2026-11-14", title: "x", bullets: ["y"] },
    { id: "no-bullets", date: "2026-11-14", title: "x", bullets: [] },
    { id: "no-title", date: "2026-11-14", title: " ", bullets: ["y"] },
    { id: "no-date", title: "x", bullets: ["y"] },
    { id: "blank-bullet", date: "2026-11-14", title: "x", bullets: ["y", ""] },
    { id: "number-bullet", date: "2026-11-14", title: "x", bullets: [1] },
    entry("ok"),
    null,
    "nope",
  ]);
  assert.deepEqual(ids(kept), ["ok"]);
  assert.deepEqual(normalizeEntries({ not: "a list" }), []);
  assert.deepEqual(normalizeEntries(undefined), []);
});

test("normalizeEntries keeps order and copies only the known fields", () => {
  const kept = normalizeEntries([{ ...entry("b"), extra: 1 }, entry("a")]);
  assert.deepEqual(ids(kept), ["b", "a"]);
  assert.deepEqual(Object.keys(kept[0]).sort(), ["bullets", "date", "id", "title"]);
});

test("validId accepts lowercase slugs only", () => {
  assert.equal(validId("2026-11-14-whats-new"), true);
  for (const bad of ["", "Has Caps", "a".repeat(65), "semi;colon", 42, null, undefined]) assert.equal(validId(bad), false, String(bad));
});

test("latestId is the first entry, or null when there are none", () => {
  assert.equal(latestId(LIST), "c");
  assert.equal(latestId([]), null);
  assert.equal(latestId(null), null);
});

test("unseenEntries: nothing seen shows all, a known id shows what is newer, the latest shows none", () => {
  assert.deepEqual(ids(unseenEntries(LIST, null)), ["c", "b", "a"]);
  assert.deepEqual(ids(unseenEntries(LIST, "a")), ["c", "b"]);
  assert.deepEqual(ids(unseenEntries(LIST, "b")), ["c"]);
  assert.deepEqual(unseenEntries(LIST, "c"), []);
  assert.deepEqual(unseenEntries([], null), []);
  assert.deepEqual(unseenEntries(null, null), []);
});

test("unseenEntries: an id from a newer release shows nothing", () => {
  assert.deepEqual(unseenEntries(LIST, "from-a-newer-build"), []);
});

test("formatEntryDate reads as day, short month, year, and leaves anything else alone", () => {
  assert.equal(formatEntryDate("2026-11-14"), "14 Nov 2026");
  assert.equal(formatEntryDate("2026-01-05"), "5 Jan 2026");
  assert.equal(formatEntryDate("2026-13-01"), "2026-13-01");
  assert.equal(formatEntryDate("soon"), "soon");
  assert.equal(formatEntryDate(undefined), "");
});

test("the shipped changelog is newest first, well formed, and free of em dashes", () => {
  assert.ok(CHANGELOG.length >= 3);
  const seen = new Set<string>();
  let previous = "9999-12-31";
  for (const item of CHANGELOG) {
    assert.ok(validId(item.id), item.id);
    assert.ok(!seen.has(item.id), `duplicate ${item.id}`);
    seen.add(item.id);
    assert.match(item.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(item.date <= previous, `${item.id} is out of order`);
    previous = item.date;
    assert.ok(item.title.length <= 60, item.title);
    assert.ok(item.bullets.length >= 1 && item.bullets.length <= 4, item.id);
    for (const line of [item.title, ...item.bullets]) {
      assert.ok(!line.includes("\u2014"), line);
      assert.ok(line.length <= 140, line);
    }
  }
  const text = CHANGELOG.map((item) => [item.title, ...item.bullets].join(" ")).join(" ");
  assert.match(text, /€5/);
  assert.match(text, /You tab/);
  assert.equal(CHANGELOG[0].date, "2026-11-14");
});

test("the service worker caches the What's new and feedback files and uses the v6 cache", () => {
  const sw = fs.readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.equal(/const CACHE = "([^"]+)"/.exec(sw)?.[1], "loaner-v6");
  const paths = [...(/const SHELL = \[([^\]]*)\]/.exec(sw)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  for (const file of ["/whats-new.js", "/changelog.js", "/whats-new-ui.js", "/sheet.js", "/feedback-ui.js", "/css/sheet.css"]) assert.ok(paths.includes(file), file);
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /href="\/css\/sheet\.css"/);
});
