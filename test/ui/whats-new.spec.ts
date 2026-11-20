import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type { Page } from "playwright-core";
import { signUp as signUpVia, useLoaner } from "./harness.js";
import { ENTRIES, LATEST_WHATS_NEW, SEEN_STORAGE_KEY } from "./whats-new-seen.js";

const SHOTS = path.resolve("test/ui/screenshots/whatsnew");
const loaner = useLoaner();

const shot = async (page: Page, name: string) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name) });
};
const seen = (page: Page) => page.evaluate((key) => localStorage.getItem(key), SEEN_STORAGE_KEY);
const sheetOf = (page: Page) => page.getByRole("dialog", { name: "What's new" });

/** Signs up through the UI, the way a new person does. Lands on the screen with no groups yet. */
async function signUp(page: Page, name: string) {
  await signUpVia(page, loaner.baseUrl, name);
  await page.getByRole("heading", { name: "No groups yet" }).waitFor();
}

test("a new sign-up starts with everything seen, then older seen ids get the newer entries once", { timeout: 90_000 }, async () => {
  assert.ok(ENTRIES.length >= 3, "the changelog has enough entries for this test");
  const ctx = await loaner.phone();
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  // 1. Sign up: no sheet, and the latest id is remembered.
  await signUp(page, "Nina");
  await page.waitForTimeout(600);
  assert.equal(await sheetOf(page).count(), 0, "no sheet after sign-up");
  assert.equal(await seen(page), LATEST_WHATS_NEW);

  // 2. An older seen id: the sheet slides up with only the newer entries.
  await page.evaluate(([key, id]) => localStorage.setItem(key, id), [SEEN_STORAGE_KEY, ENTRIES[2].id] as const);
  await page.reload();
  const sheet = sheetOf(page);
  await sheet.waitFor();
  assert.equal(await sheet.getByRole("heading", { level: 2 }).innerText(), "What's new");
  assert.equal(await sheet.locator(".wn-entry").count(), 2, "only the entries newer than the seen one");
  await sheet.getByRole("heading", { name: ENTRIES[0].title, exact: true }).waitFor();
  await sheet.getByRole("heading", { name: ENTRIES[1].title, exact: true }).waitFor();
  assert.equal(await sheet.getByRole("heading", { name: ENTRIES[2].title, exact: true }).count(), 0, "the seen entry is not listed");
  await sheet.getByText(ENTRIES[0].bullets[0], { exact: true }).waitFor();
  assert.equal(await sheet.locator(".wn-date").first().textContent(), "20 Nov 2026");
  assert.equal(await sheet.getByRole("button", { name: "Got it" }).count(), 1);

  // It slides up from the bottom of a 390x844 phone, over a scrim, with room for the safe area.
  const slide = await page.evaluate(() => {
    const el = document.querySelector(".ak-sheet")!;
    const box = el.getBoundingClientRect();
    return { animation: getComputedStyle(el).animationName, bottom: box.bottom, top: box.top, width: box.width, inner: window.innerHeight, scrim: !!document.querySelector(".ak-scrim") };
  });
  assert.equal(slide.animation, "ak-sheet-in");
  assert.ok(slide.scrim);
  assert.equal(slide.width, 390);
  assert.ok(slide.top > 40, "the sheet leaves room above it");
  await page.waitForTimeout(500);
  await shot(page, "sheet-390.png");
  assert.ok(Math.abs((await sheet.boundingBox())!.y + (await sheet.boundingBox())!.height - 844) < 1, "it rests on the bottom edge");

  // 3. Got it: gone, remembered, and not back after a reload.
  await sheet.getByRole("button", { name: "Got it" }).click();
  await sheet.waitFor({ state: "detached" });
  assert.equal(await seen(page), LATEST_WHATS_NEW);
  await page.reload();
  await page.getByRole("heading", { name: "No groups yet" }).waitFor();
  await page.waitForTimeout(600);
  assert.equal(await sheetOf(page).count(), 0, "does not come back after a reload");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("tapping the scrim or swiping down dismisses it, and an unknown seen id shows nothing", { timeout: 90_000 }, async () => {
  const ctx = await loaner.phone();
  const page = await ctx.newPage();
  await signUp(page, "Omar");
  const sheet = sheetOf(page);
  const older = ENTRIES[ENTRIES.length - 1].id;

  // Scrim tap.
  await page.evaluate(([key, id]) => localStorage.setItem(key, id), [SEEN_STORAGE_KEY, older] as const);
  await page.reload();
  await sheet.waitFor();
  assert.equal(await sheet.locator(".wn-entry").count(), ENTRIES.length - 1);
  await page.mouse.click(195, 20);
  await sheet.waitFor({ state: "detached" });
  assert.equal(await seen(page), LATEST_WHATS_NEW);

  // A short drag springs back, a long drag on the grabber dismisses.
  await page.evaluate(([key, id]) => localStorage.setItem(key, id), [SEEN_STORAGE_KEY, older] as const);
  await page.reload();
  await sheet.waitFor();
  await page.waitForTimeout(500);
  const grab = (await page.locator(".ak-grabber").boundingBox())!;
  const x = grab.x + grab.width / 2;
  const y = grab.y + grab.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 30, { steps: 4 });
  // The finger rests before it lifts. A fast short drag is a flick and dismisses.
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(300);
  assert.equal(await sheet.count(), 1, "a short drag does not dismiss");
  assert.equal(await page.evaluate(() => document.querySelector<HTMLElement>(".ak-sheet")!.style.transform), "", "it springs back");
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 160, { steps: 8 });
  await page.mouse.up();
  await sheet.waitFor({ state: "detached" });
  assert.equal(await seen(page), LATEST_WHATS_NEW);

  // A seen id from a newer release than this build: show nothing, and leave it alone.
  await page.evaluate((key) => localStorage.setItem(key, "2099-01-01-from-the-future"), SEEN_STORAGE_KEY);
  await page.reload();
  await page.getByRole("heading", { name: "No groups yet" }).waitFor();
  await page.waitForTimeout(600);
  assert.equal(await sheetOf(page).count(), 0);
  assert.equal(await seen(page), "2099-01-01-from-the-future");
  await ctx.close();
});

test("an existing session with no seen key sees everything, and You reopens the full list", { timeout: 90_000 }, async () => {
  const ctx = await loaner.phone();
  const page = await ctx.newPage();
  await signUp(page, "Pia");
  // Pretend this is a phone that was signed in before the feature shipped.
  await page.evaluate((key) => localStorage.removeItem(key), SEEN_STORAGE_KEY);
  await page.reload();
  const sheet = sheetOf(page);
  await sheet.waitFor();
  assert.equal(await sheet.locator(".wn-entry").count(), ENTRIES.length);
  await sheet.getByRole("button", { name: "Got it" }).click();
  await sheet.waitFor({ state: "detached" });
  assert.equal(await seen(page), LATEST_WHATS_NEW);

  await page.locator(".ak-tabbar").getByRole("button", { name: "You" }).click();
  await page.getByRole("heading", { level: 1, name: "You" }).waitFor();
  await page.locator("#open-whats-new").click();
  await sheet.waitFor();
  assert.equal(await sheet.locator(".wn-entry").count(), ENTRIES.length, "the list has every entry");
  await shot(page, "you-list-390.png");
  await sheet.getByRole("button", { name: "Done" }).click();
  await sheet.waitFor({ state: "detached" });
  await ctx.close();
});
