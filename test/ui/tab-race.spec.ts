import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { openWelcome, useLoaner } from "./harness.js";

const SHOTS = path.resolve("test/ui/screenshots/tab-race");
const loaner = useLoaner();

test("creating a group does not pull you back to Browse after you tapped another tab", { timeout: 60_000 }, async () => {
  const ctx = await loaner.phone();
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  // Make the create request slow, so there is time to tap away while it is out.
  await page.route("**/api/groups", async (route) => {
    if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 800));
    await route.continue();
  });

  await openWelcome(page, loaner.baseUrl);
  await page.locator("#name").fill("Tess");
  await page.locator("#email").fill("tess@example.com");
  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByRole("heading", { name: "No groups yet" }).waitFor();

  await page.locator("#group-name").fill("Flat 3B");
  await page.getByRole("button", { name: "Create group" }).click();
  await page.locator(".ak-tabbar").getByRole("button", { name: "You" }).click();
  await page.getByRole("heading", { level: 1, name: "You" }).waitFor();

  // The create request finishes while she is on You. Give it well over the delay.
  await page.waitForTimeout(2000);
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, "still-on-you.png") });

  assert.equal(new URL(page.url()).hash, "#/you", "still on the You tab");
  await page.getByRole("heading", { level: 1, name: "You" }).waitFor({ timeout: 1000 });
  assert.equal(await page.getByRole("heading", { level: 1, name: "Browse" }).count(), 0, "Browse is not showing");

  // The group was still created: Browse, opened on purpose, shows it.
  await page.locator(".ak-tabbar").getByRole("button", { name: "Browse" }).click();
  await page.locator("#group-switch").waitFor();
  assert.equal(await page.locator("#group-switch option:checked").textContent(), "Flat 3B");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("creating a group while staying put still lands on Browse", { timeout: 60_000 }, async () => {
  const ctx = await loaner.phone();
  const page = await ctx.newPage();
  await openWelcome(page, loaner.baseUrl);
  await page.locator("#name").fill("Sam");
  await page.locator("#email").fill("sam@example.com");
  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByRole("heading", { name: "No groups yet" }).waitFor();
  await page.locator("#group-name").fill("Climbing club");
  await page.getByRole("button", { name: "Create group" }).click();
  await page.locator("#group-switch").waitFor();
  assert.equal(await page.locator("#group-switch option:checked").textContent(), "Climbing club");
  assert.equal(new URL(page.url()).hash, "#/browse");
  await ctx.close();
});
