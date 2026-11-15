import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type { Page } from "playwright-core";
import { openWelcome, useLoaner } from "./harness.js";
import { solidPng } from "./png.js";

const SHOTS = path.resolve("test/ui/screenshots/flow");
const loaner = useLoaner();
let step = 0;

async function shot(page: Page, label: string): Promise<void> {
  fs.mkdirSync(SHOTS, { recursive: true });
  step += 1;
  await page.screenshot({ path: path.join(SHOTS, `${String(step).padStart(2, "0")}-${label}.png`) });
}

const tab = (page: Page, name: string) => page.locator(".ak-tabbar").getByRole("button", { name, exact: false }).click();

test("Alice lends a drill to Bob, from invite to return", { timeout: 120_000 }, async () => {
  const errors: string[] = [];
  const watch = (page: Page, who: string) => {
    page.on("pageerror", (error) => errors.push(`${who}: ${error}`));
    page.on("console", (msg) => { if (msg.type() === "error") errors.push(`${who} console: ${msg.text()}`); });
  };
  const aliceCtx = await loaner.phone();
  const bobCtx = await loaner.phone();
  const alice = await aliceCtx.newPage();
  const bob = await bobCtx.newPage();
  watch(alice, "alice");
  watch(bob, "bob");

  // Alice creates her account.
  await openWelcome(alice, loaner.baseUrl);
  await alice.getByRole("heading", { level: 1, name: "Loan some" }).waitFor();
  await shot(alice, "alice-welcome");
  await alice.locator("#name").fill("Alice");
  await alice.getByRole("button", { name: "Get started" }).click();
  await alice.locator("nav.ak-tabbar").waitFor();
  await alice.getByRole("heading", { name: "No groups yet" }).waitFor();

  // She creates a group and copies the invite link.
  await alice.locator("#group-name").fill("Flat 3B");
  await alice.getByRole("button", { name: "Create group" }).click();
  await tab(alice, "You");
  await alice.getByRole("heading", { level: 1, name: "You" }).waitFor();
  const card = alice.locator("section.card", { hasText: "Flat 3B" });
  await card.getByRole("button", { name: "Copy invite link" }).click();
  await alice.getByText("Invite link copied").waitFor();
  const invite = await alice.evaluate(() => navigator.clipboard.readText());
  assert.match(invite, new RegExp(`^${loaner.baseUrl}/join/[A-Z0-9]{10}$`));
  await shot(alice, "alice-invite-link");

  // Bob opens the link, sees the group name, creates an account and joins.
  await bob.goto(invite);
  await bob.getByRole("heading", { name: "Join Flat 3B?" }).waitFor();
  await shot(bob, "bob-join");
  await bob.locator("#name").fill("Bob");
  await bob.getByRole("button", { name: "Join Flat 3B" }).click();
  await bob.locator("nav.ak-tabbar").waitFor();
  await bob.getByText("Nothing here yet").waitFor();
  assert.equal(new URL(bob.url()).pathname, "/");
  assert.equal(await bob.locator("#group-switch option:checked").textContent(), "Flat 3B");

  // Alice lists a drill with a photo and a donation, shared to the group.
  await tab(alice, "My items");
  await alice.getByRole("button", { name: "Add an item" }).click();
  await alice.locator("#camera-type").click();
  await alice.locator("#item-name").fill("Cordless drill");
  await alice.locator("#item-note").fill("Battery lasts about 30 min");
  await alice.locator("#item-photo").setInputFiles({ name: "drill.png", mimeType: "image/png", buffer: solidPng(1600, 1200, [200, 90, 40]) });
  await alice.locator("img.preview").waitFor();
  const previewWidth = await alice.locator("img.preview").evaluate((img: HTMLImageElement) => img.naturalWidth);
  assert.equal(previewWidth, 1200, "photo is downscaled to 1200px");
  await alice.locator("#item-donation-on").check();
  await alice.locator("#item-donation").fill("5");
  assert.equal(await alice.locator('input[data-group]').count(), 1);
  assert.equal(await alice.locator('input[data-group]').isChecked(), true, "the current group is pre-selected");
  await shot(alice, "alice-new-item");
  await alice.getByRole("button", { name: "Add item" }).click();
  await alice.getByRole("heading", { level: 1, name: "Cordless drill" }).waitFor();
  await alice.getByText("Suggested donation: €5", { exact: true }).waitFor();
  await alice.locator("img.photo.big").waitFor();
  await alice.waitForFunction(() => (document.querySelector("img.photo.big") as HTMLImageElement | null)?.naturalWidth === 1200);

  // Bob browses, sees the item and its donation, and filters by available.
  await tab(bob, "Browse");
  await bob.locator('button.tile', { hasText: "Cordless drill" }).waitFor();
  await bob.getByText("From Alice").waitFor();
  await bob.getByText("Suggested donation: €5", { exact: true }).waitFor();
  await bob.locator(".tile .pill", { hasText: "Available" }).waitFor();
  await bob.waitForFunction(() => (document.querySelector(".tile img.photo") as HTMLImageElement | null)?.naturalWidth === 1200);
  await shot(bob, "bob-browse");
  await bob.locator("#available-only").check();
  await bob.locator('button.tile', { hasText: "Cordless drill" }).waitFor();
  await bob.locator('button.tile', { hasText: "Cordless drill" }).click();
  await bob.getByRole("heading", { level: 1, name: "Cordless drill" }).waitFor();
  await bob.getByText("Suggested donation: €5", { exact: true }).waitFor();
  await bob.getByText("Paid in person or by transfer, not in the app.").waitFor();
  await bob.getByText("Not lent out yet.").waitFor();

  // Bob requests it with dates and a message.
  const today = await bob.locator("#req-from").inputValue();
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
  const until = new Date(Date.parse(`${today}T00:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10);
  await bob.locator("#req-until").fill(until);
  await bob.locator("#req-message").fill("Hanging shelves this weekend");
  await shot(bob, "bob-request-form");
  await bob.getByRole("button", { name: "Send request" }).click();
  await bob.getByText("Your requests").waitFor();
  await bob.locator("article.card", { hasText: "Hanging shelves this weekend" }).locator(".pill", { hasText: "Waiting" }).waitFor();
  await shot(bob, "bob-requested");

  // Alice sees the notification (unread badge) and approves.
  await alice.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await alice.locator(".ak-tabbar .ak-badge").waitFor();
  assert.equal(await alice.locator(".ak-tabbar .ak-badge").textContent(), "1");
  await tab(alice, "Alerts");
  const note = alice.locator("article.card.unread", { hasText: "New request" });
  await note.getByText("Bob would like Cordless drill").waitFor();
  await shot(alice, "alice-alerts");
  await note.getByRole("button", { name: "Review request" }).click();
  const request = alice.locator("article.card", { hasText: "Bob wants Cordless drill" });
  await request.getByText("Hanging shelves this weekend").waitFor();
  await request.getByRole("button", { name: "Approve" }).click();
  await alice.locator("article.card", { hasText: "Bob wants Cordless drill" }).locator(".pill", { hasText: "Approved" }).waitFor();
  await shot(alice, "alice-approved");

  // Bob is told.
  await tab(bob, "Alerts");
  await bob.locator("article.card", { hasText: "Request approved" }).getByText("Alice said yes to Cordless drill").waitFor();

  // Alice hands it over: the item shows lent to Bob.
  await alice.locator("article.card", { hasText: "Bob wants Cordless drill" }).getByRole("button", { name: "Handed over" }).click();
  await alice.locator("article.card", { hasText: "Bob wants Cordless drill" }).locator(".pill", { hasText: "Lent out" }).waitFor();
  await tab(alice, "My items");
  await alice.locator("article.card", { hasText: "Cordless drill" }).locator(".pill", { hasText: "Lent to Bob until" }).waitFor();
  await shot(alice, "alice-lent");
  await tab(bob, "Browse");
  // The filter is still on, so the lent item is hidden. Turning it off shows who has it.
  await bob.getByText("Nothing available right now").waitFor();
  await shot(bob, "bob-lent-filtered");
  await bob.locator("#available-only").uncheck();
  await bob.locator(".tile .pill", { hasText: "Lent until" }).waitFor();

  // Alice marks it returned: available again.
  await tab(alice, "Requests");
  await alice.locator("article.card", { hasText: "Bob wants Cordless drill" }).getByRole("button", { name: "Returned" }).click();
  await alice.getByText("Earlier").waitFor();
  await tab(alice, "My items");
  await alice.locator("article.card", { hasText: "Cordless drill" }).locator(".pill", { hasText: "Available" }).waitFor();
  await shot(alice, "alice-returned");

  // The item history shows Bob.
  await alice.locator("article.card", { hasText: "Cordless drill" }).getByRole("button", { name: "Open" }).click();
  await alice.getByRole("heading", { level: 1, name: "Cordless drill" }).waitFor();
  const history = alice.locator("[data-history] li");
  assert.equal(await history.count(), 1);
  await history.getByText("Bob", { exact: true }).waitFor();
  assert.match(await history.innerText(), /Handed over .*returned /);
  await shot(alice, "alice-history");

  // Bob sees it available again, and the same history.
  await tab(bob, "Browse");
  await bob.locator(".tile .pill", { hasText: "Available" }).waitFor();
  await bob.locator('button.tile', { hasText: "Cordless drill" }).click();
  await bob.locator("[data-history] li", { hasText: "Bob" }).waitFor();
  await tab(bob, "Alerts");
  await bob.getByRole("heading", { name: "Returned" }).waitFor();

  // Layout: no sideways scroll, comfortable tap targets in the tab bar.
  for (const page of [alice, bob]) {
    const fit = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    assert.equal(fit.scroll, fit.client, "no horizontal scroll");
    for (const box of await page.locator(".ak-tabbar button").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))) {
      assert.ok(box >= 44, "tab bar targets are at least 44px tall");
    }
  }
  assert.deepEqual(errors, []);
  await aliceCtx.close();
  await bobCtx.close();
});

test("a bad invite link says so", { timeout: 60_000 }, async () => {
  const ctx = await loaner.phone();
  const page = await ctx.newPage();
  await page.goto(`${loaner.baseUrl}/join/NOPENOPE12`);
  await page.getByRole("heading", { name: "This invite link does not work" }).waitFor();
  await ctx.close();
});
