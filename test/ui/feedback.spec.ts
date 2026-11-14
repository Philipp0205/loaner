import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type { Page } from "playwright-core";
import { useLoaner } from "./harness.js";
import { solidPng } from "./png.js";
import { LATEST_WHATS_NEW } from "./whats-new-seen.js";

const SHOTS = path.resolve("test/ui/screenshots/feedback");
// A fake value for the harness server only.
const ADMIN = "fake-ui-admin-token-0123456789abcdefghij";
const loaner = useLoaner({ FEEDBACK_ADMIN_TOKEN: ADMIN });

const shot = async (page: Page, name: string) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name) });
};
const adminList = async (): Promise<any[]> => {
  const res = await fetch(`${loaner.baseUrl}/api/admin/feedback`, { headers: { authorization: `Bearer ${ADMIN}` } });
  assert.equal(res.status, 200);
  return ((await res.json()) as { feedback: any[] }).feedback;
};

/** Signs up through the UI, so the What's new sheet does not cover the screen. */
async function signUp(page: Page, name: string) {
  await page.goto(loaner.baseUrl);
  await page.locator("#name").fill(name);
  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByRole("heading", { name: "No groups yet" }).waitFor();
}

async function openFeedback(page: Page) {
  await page.locator(".tabbar").getByRole("button", { name: "You" }).click();
  await page.getByRole("heading", { level: 1, name: "You" }).waitFor();
  const row = page.locator("#open-feedback");
  await row.scrollIntoViewIfNeeded();
  await row.click();
  const sheet = page.locator(".sheet");
  await page.getByRole("dialog", { name: "Send feedback" }).waitFor();
  return sheet;
}

test("You has a Send feedback row; the sheet rejects empty text, sends, thanks, and the server has it", { timeout: 90_000 }, async () => {
  const ctx = await loaner.phone();
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await signUp(page, "Fiona");

  // 1. The row sits under About, next to What's new.
  await page.locator(".tabbar").getByRole("button", { name: "You" }).click();
  await page.getByRole("heading", { level: 1, name: "You" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Send feedback" }).count(), 1);
  assert.equal(await page.locator("#open-whats-new").count(), 1);
  assert.equal(await page.getByRole("dialog").count(), 0, "no What's new popup after sign-up");

  // 2. Open the sheet: a bottom sheet over a scrim on a 390 wide phone.
  const sheet = await openFeedback(page);
  await page.waitForTimeout(500);
  const box = (await sheet.boundingBox())!;
  assert.equal(box.width, 390);
  assert.ok(Math.abs(box.y + box.height - 844) < 1, "rests on the bottom edge");
  assert.equal(await sheet.getByRole("heading", { level: 2 }).innerText(), "Send feedback");
  assert.equal(await sheet.locator("textarea").getAttribute("maxlength"), "2000");
  await sheet.getByText("0/2000").waitFor();
  await shot(page, "sheet-empty-390.png");

  // Empty and whitespace-only text stay put with an error, and nothing is sent.
  const send = sheet.getByRole("button", { name: "Send" });
  await send.click();
  await sheet.getByRole("alert").getByText("Write something first.").waitFor();
  await sheet.locator("textarea").fill("   \n  ");
  await send.click();
  await sheet.getByRole("alert").getByText("Write something first.").waitFor();
  assert.equal((await adminList()).length, 0);
  await shot(page, "sheet-error-390.png");

  // Typing clears the error and updates the live count.
  const typed = "  The recovery code is easy to miss.\nMaybe show it twice?  ";
  await sheet.locator("textarea").fill(typed);
  assert.equal(await sheet.locator("#feedback-error").innerText(), "");
  await sheet.getByText(`${typed.length}/2000`).waitFor();
  await shot(page, "sheet-typed-390.png");

  // A failed send (here a 429) keeps the draft and says why.
  await page.route("**/api/feedback", (route) => route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "That is a lot of feedback at once. Try again later." }) }), { times: 1 });
  await send.click();
  await sheet.getByRole("alert").getByText("That is a lot of feedback at once. Try again later.").waitFor();
  assert.equal(await sheet.locator("textarea").inputValue(), typed);
  await sheet.getByRole("button", { name: "Send" }).waitFor();
  assert.equal(await send.isDisabled(), false);
  assert.equal((await adminList()).length, 0);

  // 3. Send for real: the form is replaced by a thanks, and Done closes it.
  await send.click();
  await sheet.getByRole("heading", { name: "Thanks!" }).waitFor();
  assert.equal(await sheet.locator("textarea").count(), 0);
  await shot(page, "sheet-thanks-390.png");
  await sheet.getByRole("button", { name: "Done" }).click();
  await sheet.waitFor({ state: "detached" });

  // The server stored it, through the admin API.
  const rows = await adminList();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].text, "The recovery code is easy to miss.\nMaybe show it twice?");
  assert.equal(rows[0].displayName, "Fiona");
  assert.equal(rows[0].status, "new");
  assert.equal(rows[0].hasPhoto, false);
  assert.match(rows[0].userAgent, /Pixel 8/);
  assert.equal(rows[0].appVersion, LATEST_WHATS_NEW, "the app version is the newest What's new id");

  // Reopening starts with a clean form.
  const again = await openFeedback(page);
  assert.equal(await again.locator("textarea").inputValue(), "");
  await page.keyboard.press("Escape");
  await again.waitFor({ state: "detached" });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("the sheet closes by scrim and swipe, and a photo can be attached", { timeout: 90_000 }, async () => {
  const ctx = await loaner.phone();
  const page = await ctx.newPage();
  await signUp(page, "Gil");

  let sheet = await openFeedback(page);
  await page.waitForTimeout(500);
  await page.mouse.click(195, 20);
  await sheet.waitFor({ state: "detached" });

  sheet = await openFeedback(page);
  await page.waitForTimeout(500);
  const grab = (await page.locator(".grabber").boundingBox())!;
  const x = grab.x + grab.width / 2;
  const y = grab.y + grab.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 160, { steps: 8 });
  await page.mouse.up();
  await sheet.waitFor({ state: "detached" });

  sheet = await openFeedback(page);
  await sheet.locator("textarea").fill("Here is what I saw.");
  await sheet.locator("#feedback-photo").setInputFiles({ name: "shot.png", mimeType: "image/png", buffer: solidPng(60, 40, [20, 120, 110]) });
  await sheet.getByAltText("Attached photo preview").waitFor();
  await page.waitForTimeout(500);
  const dock = (await sheet.getByRole("button", { name: "Send" }).boundingBox())!;
  assert.ok(dock.y >= 0 && dock.y + dock.height <= 844, "the Send button is on screen with a photo attached");
  const sheetBox = (await sheet.boundingBox())!;
  assert.ok(sheetBox.y >= 0 && Math.abs(sheetBox.y + sheetBox.height - 844) < 1, "the sheet rests on the bottom edge");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "no sideways scroll");
  await shot(page, "sheet-photo-390.png");
  await sheet.getByRole("button", { name: "Send" }).click();
  await sheet.getByRole("heading", { name: "Thanks!" }).waitFor();
  await sheet.getByRole("button", { name: "Done" }).click();
  await sheet.waitFor({ state: "detached" });

  const row = (await adminList()).find((f) => f.displayName === "Gil");
  assert.ok(row, "Gil's feedback is stored");
  assert.equal(row.hasPhoto, true);
  const photo = await fetch(`${loaner.baseUrl}/api/admin/feedback/${row.id}/photo`, { headers: { authorization: `Bearer ${ADMIN}` } });
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get("content-type"), "image/jpeg");
  await ctx.close();
});
