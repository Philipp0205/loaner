import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "playwright-core";
import { bellBadge, openAlerts, openWelcome, useLoaner } from "./harness.js";
import { skipWhatsNew } from "./whats-new-seen.js";

const loaner = useLoaner();
const tab = (page: Page, name: string) => page.locator(".ak-tabbar").getByRole("button", { name, exact: false }).click();

test("a friend adds an item and the other member gets an alert that opens it", { timeout: 120_000 }, async () => {
  const errors: string[] = [];
  const watch = (page: Page, who: string) => {
    page.on("pageerror", (error) => errors.push(`${who}: ${error}`));
    page.on("console", (msg) => { if (msg.type() === "error") errors.push(`${who} console: ${msg.text()}`); });
  };
  const aliceCtx = await loaner.phone();
  const bobCtx = await loaner.phone();
  await skipWhatsNew(aliceCtx);
  await skipWhatsNew(bobCtx);
  const alice = await aliceCtx.newPage();
  const bob = await bobCtx.newPage();
  watch(alice, "alice");
  watch(bob, "bob");

  // Alice makes a group and Bob joins it.
  await openWelcome(alice, loaner.baseUrl);
  await alice.locator("#name").fill("Alice");
  await alice.locator("#email").fill("alice@example.com");
  await alice.getByRole("button", { name: "Get started" }).click();
  await alice.getByRole("heading", { name: "No groups yet" }).waitFor();
  await alice.locator("#group-name").fill("Flat 3B");
  await alice.getByRole("button", { name: "Create group" }).click();
  await tab(alice, "You");
  await alice.locator("section.card", { hasText: "Flat 3B" }).getByRole("button", { name: "Copy invite link" }).click();
  await alice.getByText("Invite link copied").waitFor();
  const invite = await alice.evaluate(() => navigator.clipboard.readText());
  await bob.goto(invite);
  await bob.locator("#name").fill("Bob");
  await bob.locator("#email").fill("bob@example.com");
  await bob.getByRole("button", { name: "Join Flat 3B" }).click();
  await bob.locator("nav.ak-tabbar").waitFor();
  await bob.getByText("Nothing here yet").waitFor();

  // Alice adds an item the camera-add way (Type it in).
  await tab(alice, "My items");
  await alice.getByRole("button", { name: "Add an item" }).click();
  await alice.locator("#camera-type").click();
  await alice.locator("#item-name").fill("Cordless drill");
  await alice.getByRole("button", { name: "Add item" }).click();
  await alice.getByRole("heading", { level: 1, name: "Cordless drill" }).waitFor();

  // Bob sees the alert, unread, then opens the item from it.
  await bob.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await bellBadge(bob).waitFor();
  assert.equal(await bellBadge(bob).textContent(), "1");
  assert.equal(await bob.locator(".ak-tabbar .ak-badge").count(), 0, "alerts are not counted on the tab bar");
  await openAlerts(bob);
  const note = bob.locator("article.card.unread", { hasText: "Alice added Cordless drill" });
  await note.getByText("It's now on the shelf.").waitFor();
  assert.equal(await note.getAttribute("data-note"), "item_new");
  await note.getByRole("button", { name: "Open" }).click();
  await bob.getByRole("heading", { level: 1, name: "Cordless drill" }).waitFor();
  assert.match(new URL(bob.url()).hash, /^#\/item\/[^/]+$/);
  await bob.getByText("Owned by Alice").waitFor();

  // Alice, the owner, has no alert about her own item. The bell lives on tab roots, so leave the item page first.
  await tab(alice, "Browse");
  await openAlerts(alice);
  await alice.getByText("All quiet").waitFor();

  assert.deepEqual(errors, []);
  await aliceCtx.close();
  await bobCtx.close();
});
