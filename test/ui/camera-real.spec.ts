import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type { Page } from "playwright-core";
import { useLoaner } from "./harness.js";
import { cacheModelFiles } from "./model-cache.js";

// The real path: no __loanerSuggestFromPhoto stub, the app's real CSP, a real photo, and the real model
// when the network allows it. Whatever the network does, the form must open.
const SHOTS = path.resolve("test/ui/screenshots/camera-real");
const DRILL = path.resolve("test/fixtures/cordless-drill.jpg");
const BOUND_MS = 25_000; // the app gives up at 15 s; the rest is headroom for the downscale and a busy machine
const loaner = useLoaner({}, ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"]);

async function startOnMyItems(page: Page) {
  await page.goto(loaner.baseUrl);
  await page.locator("#name").fill("Real");
  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByRole("heading", { name: "No groups yet" }).waitFor();
  await page.locator("#group-name").fill("Flat 3B");
  await page.getByRole("button", { name: "Create group" }).click();
  await page.locator(".tabbar").getByRole("button", { name: "My items" }).click();
  await page.getByRole("heading", { level: 1, name: "My items" }).waitFor();
  await page.getByRole("button", { name: "Add an item" }).click();
  await page.locator("#camera-add").waitFor();
}

test("a real photo through the real model path always reaches the form, never stuck on Looking", { timeout: 180_000 }, async (t) => {
  const ctx = await loaner.phone();
  const cache = await cacheModelFiles(ctx);
  const page = await ctx.newPage();
  const errors: string[] = [];
  const csp: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => ((window as unknown as { __csp: string[] }).__csp ||= []).push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  await startOnMyItems(page);
  assert.equal(await page.evaluate(() => typeof (window as unknown as Record<string, unknown>).__loanerSuggestFromPhoto), "undefined", "no stub");

  const started = Date.now();
  await page.locator("#camera-gallery").setInputFiles(DRILL);
  await page.locator("#camera-status", { hasText: /Looking at the photo|Downloading/ }).waitFor({ timeout: 5_000 });

  // While it looks, Type it in is enabled and Take photo / From gallery are not.
  assert.equal(await page.locator("#camera-type").isEnabled(), true, "Type it in stays tappable");
  assert.equal(await page.locator("#camera-gallery").isDisabled(), true);
  await page.screenshot({ path: (fs.mkdirSync(SHOTS, { recursive: true }), path.join(SHOTS, "01-looking.png")) });

  await page.locator("#item-name").waitFor({ timeout: BOUND_MS });
  const toForm = Date.now() - started;
  assert.equal(new URL(page.url()).hash, "#/mine/new/form");
  assert.equal(await page.locator("#camera-status").count(), 0, "no longer on the camera screen");
  await page.locator("img.preview").waitFor();
  assert.ok((await page.locator("img.preview").evaluate((img: HTMLImageElement) => img.naturalWidth)) > 0, "the photo is attached");
  assert.equal(await page.locator("#item-name").isEditable(), true);
  assert.equal(await page.locator("#item-category").isEnabled(), true);

  const name = await page.locator("#item-name").inputValue();
  const category = await page.locator("#item-category").inputValue();
  const note = (await page.locator("#suggest-note").innerText()).trim();
  const suggested = name !== "";
  if (suggested) {
    assert.notEqual(category, "", "a suggestion brings a category");
  } else {
    assert.equal(category, "");
    assert.notEqual(note, "", "the fallback shows a quiet note");
  }
  await page.screenshot({ path: path.join(SHOTS, "02-form.png") });
  const csps: string[] = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
  t.diagnostic(`form after ${toForm} ms; ${suggested ? `suggested "${name}" / ${category}` : `fallback note "${note}"`}; model cache hits ${cache.stats.hits}, misses ${cache.stats.misses}, failures ${cache.stats.failures}; CSP violations ${csps.length}`);

  // The person can type over it and save, whichever path it took.
  await page.locator("#item-name").fill("Drill driver");
  await page.getByRole("button", { name: "Add item" }).click();
  await page.getByRole("heading", { level: 1, name: "Drill driver" }).waitFor();

  assert.deepEqual(errors, []);
  assert.deepEqual(csps.concat(csp), [], "no CSP violations");
  // A cold run lets the downloads finish so the next run starts from the cache.
  await cache.pending(90_000);
  await ctx.close();
});

test("with the model hosts unreachable, the real path falls back fast: photo kept, empty editable form, a note", { timeout: 90_000 }, async () => {
  const ctx = await loaner.phone();
  await ctx.route(/^https:\/\/(cdn\.jsdelivr\.net|([^/]*\.)?huggingface\.co|[^/]*\.hf\.co)\//, (route) => route.abort("internetdisconnected"));
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await startOnMyItems(page);
  const started = Date.now();
  await page.locator("#camera-gallery").setInputFiles(DRILL);
  await page.locator("#item-name").waitFor({ timeout: BOUND_MS });
  assert.ok(Date.now() - started < BOUND_MS);
  assert.equal(await page.locator("#item-name").inputValue(), "");
  assert.equal(await page.locator("#item-category").inputValue(), "");
  assert.equal(await page.locator("#item-name").isEditable(), true);
  assert.match(await page.locator("#suggest-note").innerText(), /type one in|still looking/i);
  await page.locator("img.preview").waitFor();
  assert.deepEqual(errors, []);
  await ctx.close();
});
