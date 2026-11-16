import assert from "node:assert/strict";
import test from "node:test";
import { openWelcome, useLoaner } from "./harness.js";

const loaner = useLoaner();

test("a group can be renamed from the You tab, and an empty name is rejected", { timeout: 60_000 }, async () => {
  const ctx = await loaner.phone();
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  await openWelcome(page, loaner.baseUrl);
  await page.locator("#name").fill("Tess");
  await page.locator("#email").fill("tess@example.com");
  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByRole("heading", { name: "No groups yet" }).waitFor();
  await page.locator("#group-name").fill("Flat 3B");
  await page.getByRole("button", { name: "Create group" }).click();
  await page.locator("#group-switch").waitFor();

  await page.locator(".ak-tabbar").getByRole("button", { name: "You" }).click();
  const card = page.locator("section.card[data-group]");
  await card.getByRole("heading", { name: "Flat 3B" }).waitFor();

  // An empty name is rejected, the form stays, the old name remains.
  await card.getByRole("button", { name: "Rename" }).click();
  const input = page.locator("input#group-rename-name");
  assert.equal(await input.inputValue(), "Flat 3B");
  await input.fill("   ");
  await card.getByRole("button", { name: "Save name" }).click();
  await card.getByRole("alert").filter({ hasText: /\S/ }).waitFor();
  assert.equal(await input.isVisible(), true, "the form is still there");
  assert.equal(await card.getByRole("heading", { name: "Flat 3B" }).count(), 1, "old name remains");

  // A real name is saved and shows on the card and in the Browse switcher.
  await input.fill("Studio 4");
  await card.getByRole("button", { name: "Save name" }).click();
  await page.locator("section.card[data-group]").getByRole("heading", { name: "Studio 4" }).waitFor();
  assert.equal(await page.locator("input#group-rename-name").count(), 0, "form closed after saving");
  assert.equal(await page.getByRole("heading", { name: "Flat 3B" }).count(), 0);

  await page.locator(".ak-tabbar").getByRole("button", { name: "Browse" }).click();
  await page.locator("#group-switch").waitFor();
  assert.equal(await page.locator("#group-switch option:checked").textContent(), "Studio 4");
  assert.deepEqual(errors, []);
  await ctx.close();
});
