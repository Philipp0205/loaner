import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type { Page } from "playwright-core";
import { openWelcome, useLoaner } from "./harness.js";

// The real path: the app's real CSP, a real photo file, a real upload to the server. No stubs and no network
// beyond the test server. The page must open the form with the photo, save it, and raise no CSP violation.
const SHOTS = path.resolve("test/ui/screenshots/camera-real");
const DRILL = path.resolve("test/fixtures/cordless-drill.jpg");
const loaner = useLoaner({}, ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"]);

async function startOnMyItems(page: Page) {
  await openWelcome(page, loaner.baseUrl);
  await page.locator("#name").fill("Real");
  await page.locator("#email").fill("real@example.com");
  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByRole("heading", { name: "No groups yet" }).waitFor();
  await page.locator("#group-name").fill("Flat 3B");
  await page.getByRole("button", { name: "Create group" }).click();
  await page.locator(".ak-tabbar").getByRole("button", { name: "My items" }).click();
  await page.getByRole("heading", { level: 1, name: "My items" }).waitFor();
  await page.getByRole("button", { name: "Add an item" }).click();
  await page.locator("#camera-add").waitFor();
}

test("a real photo from the gallery reaches the form, uploads, and shows on the item page with no CSP violation", { timeout: 90_000 }, async () => {
  const ctx = await loaner.phone();
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => ((window as unknown as { __csp: string[] }).__csp ||= []).push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  await startOnMyItems(page);

  await page.locator("#camera-gallery").setInputFiles(DRILL);
  await page.locator("#item-name").waitFor({ timeout: 20_000 });
  assert.equal(new URL(page.url()).hash, "#/mine/new/form");
  assert.equal(await page.locator("#item-name").inputValue(), "", "nothing is guessed from the photo");
  assert.equal(await page.locator("#item-category").inputValue(), "");
  assert.equal(await page.locator("#suggest-note").count(), 0, "no suggestion note");
  await page.locator("img.preview").waitFor();
  assert.ok((await page.locator("img.preview").evaluate((img: HTMLImageElement) => img.naturalWidth)) > 0, "the photo is attached");
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, "01-form.png") });

  await page.locator("#item-name").fill("Drill driver");
  await page.getByRole("button", { name: "Add item" }).click();
  await page.getByRole("heading", { level: 1, name: "Drill driver" }).waitFor();
  await page.locator(".hero img.photo.big").waitFor();
  await page.waitForFunction(() => {
    const img = document.querySelector<HTMLImageElement>(".hero img.photo.big");
    return !!img && img.naturalWidth > 0;
  });
  await page.screenshot({ path: path.join(SHOTS, "02-item.png") });

  const csps: string[] = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
  assert.deepEqual(errors, []);
  assert.deepEqual(csps, [], "no CSP violations");
  await ctx.close();
});
