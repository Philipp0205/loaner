import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { MAX_PHOTOS as SERVER_MAX } from "../src/photos/image.js";

// These client modules are plain JS with no DOM use at import time, so node can load them directly.
const load = async <T>(file: string): Promise<T> => (await import(new URL(`../public/${file}`, import.meta.url).href)) as T;

const { MAX_PHOTOS } = await load<{ MAX_PHOTOS: number }>("photos/limits.js");
const { slotsLeft, limitFiles, indexFromScroll, indexAfterKey } = await load<{
  slotsLeft: (have: number, max?: number) => number;
  limitFiles: (files: unknown[], have: number, max?: number) => { kept: unknown[]; dropped: number };
  indexFromScroll: (scrollLeft: number, width: number, count: number) => number;
  indexAfterKey: (key: string, index: number, count: number) => number | null;
}>("photos/pure.js");
const { parseDonation, donationFields } = await load<{
  parseDonation: (raw: unknown) => { amount?: number; text?: string; error?: string };
  donationFields: (parsed: unknown) => { donation: number | null; donationText: string | null };
}>("donation/parse.js");
const { hasDonation, donationLabel, donationInputValue } = await load<{
  hasDonation: (item: object) => boolean;
  donationLabel: (item: object) => string;
  donationInputValue: (item: object | null) => string;
}>("donation/label.js");

test("the client and the server agree on the photo limit", () => {
  assert.equal(MAX_PHOTOS, 6);
  assert.equal(MAX_PHOTOS, SERVER_MAX);
});

test("slotsLeft never goes below 0", () => {
  assert.equal(slotsLeft(0), 6);
  assert.equal(slotsLeft(4), 2);
  assert.equal(slotsLeft(6), 0);
  assert.equal(slotsLeft(9), 0);
});

test("limitFiles keeps the first files that fit and counts the rest", () => {
  assert.deepEqual(limitFiles(["a", "b", "c"], 0), { kept: ["a", "b", "c"], dropped: 0 });
  assert.deepEqual(limitFiles(["a", "b", "c"], 5), { kept: ["a"], dropped: 2 });
  assert.deepEqual(limitFiles(["a", "b"], 6), { kept: [], dropped: 2 });
  assert.deepEqual(limitFiles([], 2), { kept: [], dropped: 0 });
});

test("indexFromScroll rounds to the nearest slide and is safe at the edges", () => {
  assert.equal(indexFromScroll(0, 300, 3), 0);
  assert.equal(indexFromScroll(140, 300, 3), 0);
  assert.equal(indexFromScroll(160, 300, 3), 1);
  assert.equal(indexFromScroll(600, 300, 3), 2);
  assert.equal(indexFromScroll(900, 300, 3), 2, "a bounce past the end");
  assert.equal(indexFromScroll(-40, 300, 3), 0, "a bounce before the start");
  assert.equal(indexFromScroll(100, 0, 3), 0, "no width yet");
  assert.equal(indexFromScroll(100, 300, 0), 0, "no slides");
});

test("indexAfterKey moves by one, stops at both ends and ignores other keys", () => {
  assert.equal(indexAfterKey("ArrowRight", 0, 3), 1);
  assert.equal(indexAfterKey("ArrowRight", 2, 3), 2);
  assert.equal(indexAfterKey("ArrowLeft", 2, 3), 1);
  assert.equal(indexAfterKey("ArrowLeft", 0, 3), 0);
  assert.equal(indexAfterKey("Enter", 1, 3), null);
});

test("parseDonation: numbers are amounts, in any of the usual ways", () => {
  for (const [typed, amount] of [["5", 5], ["5.5", 5.5], ["5,5", 5.5], ["€7", 7], ["7 €", 7], ["EUR 12.50", 12.5], [" 3 ", 3]] as const) {
    assert.deepEqual(parseDonation(typed), { amount }, typed);
  }
});

test("parseDonation: anything else is words, and empty is an error", () => {
  assert.deepEqual(parseDonation("a beer"), { text: "a beer" });
  assert.deepEqual(parseDonation("  a   beer  "), { text: "a beer" }, "spaces are tidied");
  assert.deepEqual(parseDonation("5 euros or a beer"), { text: "5 euros or a beer" });
  assert.ok(parseDonation("").error);
  assert.ok(parseDonation("   ").error);
  assert.ok(parseDonation(null).error);
});

test("donationFields sends exactly one of the two fields", () => {
  assert.deepEqual(donationFields({ amount: 5 }), { donation: 5, donationText: null });
  assert.deepEqual(donationFields({ text: "a beer" }), { donation: null, donationText: "a beer" });
  assert.deepEqual(donationFields(null), { donation: null, donationText: null });
});

test("donation labels: amounts as euros, words as typed, nothing when there is none", () => {
  assert.equal(hasDonation({ donation: 5, donationText: null }), true);
  assert.equal(hasDonation({ donation: null, donationText: "a beer" }), true);
  assert.equal(hasDonation({ donation: null, donationText: null }), false);
  assert.equal(hasDonation({}), false);
  assert.equal(donationLabel({ donation: 5, donationText: null }), "€5");
  assert.equal(donationLabel({ donation: 12.5, donationText: null }), "€12.50");
  assert.equal(donationLabel({ donation: null, donationText: "a beer" }), "a beer");
  assert.equal(donationLabel({ donation: null, donationText: null }), "");
});

test("donationInputValue prefills the form with the plain number or the words", () => {
  assert.equal(donationInputValue({ donation: 5, donationText: null }), "5");
  assert.equal(donationInputValue({ donation: 12.5, donationText: null }), "12.50");
  assert.equal(donationInputValue({ donation: null, donationText: "a beer" }), "a beer");
  assert.equal(donationInputValue({ donation: null, donationText: null }), "");
  assert.equal(donationInputValue(null), "");
});

test("every new client module is in the service worker shell", () => {
  const sw = fs.readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  for (const file of ["photos/limits.js", "photos/copy.js", "photos/pure.js", "photos/gallery.js", "photos/picker.js", "donation/copy.js", "donation/parse.js", "donation/label.js", "css/photos.css"]) {
    assert.ok(sw.includes(`"/${file}"`) || sw.includes(`"${file}"`), `${file} is in the shell`);
  }
});
