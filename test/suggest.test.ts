import assert from "node:assert/strict";
import test from "node:test";
import { CATEGORIES } from "../src/categories.js";

type Result = { label: string; score: number };
type Guess = { name: string; category: string; score?: number } | null;
type Labels = {
  LABELS: [string, string][];
  PROMPT_LABELS: string[];
  MIN_SCORE: number;
  categoryFor: (name: string) => string;
  pickBest: (results: unknown, min?: number) => Guess;
};
type Suggest = { suggestFromPhoto: (blob: unknown, load?: () => Promise<(blob: unknown) => Promise<Result[]>>) => Promise<Guess> };

// Both files are plain JS with no DOM use at import time, so node can load them directly.
const { LABELS, PROMPT_LABELS, MIN_SCORE, categoryFor, pickBest } = (await import(new URL("../public/suggest-labels.js", import.meta.url).href)) as Labels;
const { suggestFromPhoto } = (await import(new URL("../public/suggest-photo.js", import.meta.url).href)) as Suggest;
const stubbed = globalThis as { __loanerSuggestFromPhoto?: unknown };

test("the label list is 40 to 80 loanable things, each mapped to a real category", () => {
  assert.ok(LABELS.length >= 40 && LABELS.length <= 80, String(LABELS.length));
  const names = new Set<string>();
  for (const [name, category] of LABELS) {
    assert.ok(CATEGORIES.includes(category as never), `${name}: ${category}`);
    assert.ok(!names.has(name.toLowerCase()), `duplicate ${name}`);
    names.add(name.toLowerCase());
  }
  for (const name of ["Cordless drill", "Hammer", "Screwdriver", "Wrench", "Pliers", "Circular saw", "Jigsaw", "Sander", "Ladder", "Tape measure", "Shovel", "Rake", "Lawn mower", "Blender", "Frying pan", "Tent", "Sleeping bag", "Camping stove", "Cooler", "Bicycle", "Projector", "Camera", "Speaker", "Guitar", "Board game", "Kayak", "Helmet"]) {
    assert.ok(names.has(name.toLowerCase()), name);
  }
  assert.deepEqual(PROMPT_LABELS, LABELS.map(([name]) => name.toLowerCase()));
});

test("categoryFor maps a name to its category, ignoring case, and falls back to Other", () => {
  assert.equal(categoryFor("Cordless drill"), "Tools");
  assert.equal(categoryFor("tent"), "Camping");
  assert.equal(categoryFor("Board game"), "Kids");
  assert.equal(categoryFor("Something unknown"), "Other");
});

test("pickBest takes the highest score and maps the category", () => {
  const best = pickBest([{ label: "hammer", score: 0.1 }, { label: "cordless drill", score: 0.7 }, { label: "tent", score: 0.2 }]);
  assert.deepEqual(best, { name: "Cordless drill", category: "Tools", score: 0.7 });
});

test("pickBest returns null when the best score is weak, and a score at the threshold passes", () => {
  assert.equal(pickBest([{ label: "hammer", score: MIN_SCORE - 0.01 }, { label: "tent", score: 0.05 }]), null);
  assert.equal(pickBest([{ label: "hammer", score: MIN_SCORE }])?.name, "Hammer");
  assert.equal(pickBest([{ label: "hammer", score: 0.3 }], 0.5), null, "a custom threshold is honoured");
});

test("pickBest ignores junk and returns null for empty or unknown input", () => {
  for (const bad of [undefined, null, "x", {}, [], [null], [{ label: "hammer" }], [{ label: "hammer", score: Number.NaN }], [{ label: "spaceship", score: 0.99 }]]) {
    assert.equal(pickBest(bad), null, JSON.stringify(bad));
  }
  assert.equal(pickBest([{ label: "spaceship", score: 0.99 }, { label: "rake", score: 0.4 }])?.name, "Rake");
});

test("suggestFromPhoto uses the test stub when one is set, and never loads a model", async () => {
  let loaded = false;
  stubbed.__loanerSuggestFromPhoto = async () => ({ name: "Cordless drill", category: "Tools" });
  try {
    const got = await suggestFromPhoto({}, async () => { loaded = true; return async () => []; });
    assert.deepEqual(got, { name: "Cordless drill", category: "Tools" });
    assert.equal(loaded, false);
    stubbed.__loanerSuggestFromPhoto = async () => undefined;
    assert.equal(await suggestFromPhoto({}), null, "a stub with no answer is null");
    stubbed.__loanerSuggestFromPhoto = async () => { throw new Error("boom"); };
    assert.equal(await suggestFromPhoto({}), null, "a throwing stub is null");
  } finally {
    delete stubbed.__loanerSuggestFromPhoto;
  }
});

test("suggestFromPhoto returns null when the model cannot load or fails", async () => {
  assert.equal(await suggestFromPhoto({}, async () => { throw new Error("offline"); }), null);
  assert.equal(await suggestFromPhoto({}, async () => async () => { throw new Error("bad image"); }), null);
});

test("suggestFromPhoto turns model output into a suggestion, or null when unsure", async () => {
  const sure = await suggestFromPhoto({}, async () => async () => [{ label: "tent", score: 0.8 }, { label: "kayak", score: 0.1 }]);
  assert.deepEqual(sure, { name: "Tent", category: "Camping", score: 0.8 });
  assert.equal(await suggestFromPhoto({}, async () => async () => [{ label: "tent", score: 0.05 }]), null);
});
