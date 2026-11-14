import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type { Page } from "playwright-core";
import { useLoaner } from "./harness.js";
import { skipWhatsNew } from "./whats-new-seen.js";

const SHOTS = path.resolve("test/ui/screenshots/euros");
const loaner = useLoaner();

async function call(method: string, url: string, token: string | null, body?: unknown): Promise<any> {
  const res = await fetch(`${loaner.baseUrl}${url}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.ok(res.ok, `${method} ${url} -> ${res.status}`);
  return res.json();
}

/** Alice owns a 5 euro drill and a 12.50 euro tent that is lent to Bob. Returns Bob's token and today's date. */
async function seed() {
  const alice = await call("POST", "/api/auth/start", null, { name: "Alice" });
  const bob = await call("POST", "/api/auth/start", null, { name: "Bob" });
  const { group } = await call("POST", "/api/groups", alice.token, { name: "Flat 3B" });
  await call("POST", `/api/invites/${group.inviteCode}/join`, bob.token);
  const drill = (await call("POST", "/api/items", alice.token, { name: "Cordless drill", note: "", donation: 5, groupIds: [group.id] })).item;
  const tent = (await call("POST", "/api/items", alice.token, { name: "Four person tent", note: "", donation: 12.5, groupIds: [group.id] })).item;
  const { today } = await call("GET", "/api/me", bob.token);
  const until = new Date(Date.parse(`${today}T00:00:00Z`) + 3 * 86_400_000).toISOString().slice(0, 10);
  const { request } = await call("POST", `/api/items/${tent.id}/requests`, bob.token, { from: today, until, message: "Camping" });
  await call("POST", `/api/requests/${request.id}/approve`, alice.token, {});
  await call("POST", `/api/requests/${request.id}/handover`, alice.token);
  return { alice, bob, drill, tent, until };
}

async function signedIn(token: string, size: { width: number; height: number }): Promise<Page> {
  const ctx = await loaner.phone();
  await ctx.addInitScript((t) => localStorage.setItem("loaner_token", t), token);
  await skipWhatsNew(ctx);
  const page = await ctx.newPage();
  await page.setViewportSize(size);
  return page;
}

const shot = async (page: Page, name: string) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name) });
};

test("suggested donation shows as euros on the tile, the item page and the item form", { timeout: 90_000 }, async () => {
  const { alice, bob, drill, tent } = await seed();

  const browse = await signedIn(bob.token, { width: 390, height: 844 });
  await browse.goto(loaner.baseUrl);
  const drillTile = browse.locator("button.tile", { hasText: "Cordless drill" });
  const tentTile = browse.locator("button.tile", { hasText: "Four person tent" });
  await drillTile.waitFor();
  assert.equal(await drillTile.locator(".donation").innerText(), "Suggested donation: €5");
  assert.equal(await tentTile.locator(".donation").innerText(), "Suggested donation: €12.50");

  await tentTile.click();
  await browse.getByRole("heading", { level: 1, name: "Four person tent" }).waitFor();
  const callout = browse.locator("[data-donation]");
  assert.equal(await callout.locator("strong").innerText(), "Suggested donation: €12.50");
  assert.match(await callout.innerText(), /Paid in person or by transfer, not in the app\./);
  assert.match(await browse.locator(".row .pill").first().innerText(), /^Lent to Bob until \d{1,2} \w{3}$/, "the detail keeps the full pill text");
  await shot(browse, "item-detail.png");
  await browse.goto(`${loaner.baseUrl}/#/item/${drill.id}`);
  await browse.locator("[data-donation] strong", { hasText: "€5" }).waitFor();
  assert.equal(await browse.locator("[data-donation] strong").innerText(), "Suggested donation: €5");

  // My items cards do not show the amount, so there is nothing to format there.
  const owner = await signedIn(alice.token, { width: 390, height: 844 });
  await owner.goto(`${loaner.baseUrl}/#/mine`);
  await owner.locator("article.card", { hasText: "Four person tent" }).waitFor();
  assert.equal(await owner.locator("article.card", { hasText: "Four person tent" }).getByText(/donation|€/).count(), 0);

  // The form: the label says euros, there is a visible euro sign, and the stored amount is prefilled.
  await owner.goto(`${loaner.baseUrl}/#/mine/edit/${tent.id}`);
  await owner.getByText("Suggested amount (EUR)").waitFor();
  assert.equal(await owner.locator(".money-sign").innerText(), "€");
  assert.equal(await owner.locator("#item-donation").inputValue(), "12.50");
  await shot(owner, "item-form.png");

  // 5, 5.5 and 5,5 are all accepted, and shown back as euros.
  for (const [typed, shown] of [["5", "€5"], ["5.5", "€5.50"], ["5,5", "€5.50"]] as const) {
    await owner.goto(`${loaner.baseUrl}/#/mine/edit/${drill.id}`);
    await owner.locator("#item-donation").fill(typed);
    await owner.getByRole("button", { name: "Save changes" }).click();
    await owner.locator("[data-donation] strong").waitFor();
    await owner.getByText(`Suggested donation: ${shown}`).waitFor();
  }
});

for (const size of [{ width: 360, height: 780 }, { width: 390, height: 844 }]) {
  test(`browse tiles keep the pill and the donation on one line at ${size.width}px`, { timeout: 60_000 }, async () => {
    const { bob } = await seed();
    const page = await signedIn(bob.token, size);
    await page.goto(loaner.baseUrl);
    await page.locator("button.tile", { hasText: "Four person tent" }).waitFor();
    await page.locator("button.tile", { hasText: "Cordless drill" }).waitFor();
    await shot(page, `browse-${size.width}.png`);

    const pills = page.locator(".tile .pill");
    assert.equal(await pills.count(), 2);
    for (const box of await pills.evaluateAll((els) => els.map((el) => ({ text: el.textContent, height: el.getBoundingClientRect().height, font: parseFloat(getComputedStyle(el).fontSize) })))) {
      assert.ok(box.height < box.font * 1.6, `pill "${box.text}" is one line (${box.height}px high, font ${box.font}px)`);
    }
    const lent = await page.locator(".tile .pill.lent").innerText();
    assert.match(lent, /^Lent until \d{1,2} \w{3}$/, "the tile pill is short");

    const donations = page.locator(".tile .donation");
    assert.equal(await donations.count(), 2);
    for (const box of await donations.evaluateAll((els) => els.map((el) => ({ text: el.textContent, height: el.getBoundingClientRect().height, font: parseFloat(getComputedStyle(el).fontSize) })))) {
      assert.ok(box.height < box.font * 1.6, `"${box.text}" is one line (${box.height}px high, font ${box.font}px)`);
    }

    const overflow = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      tiles: [...document.querySelectorAll(".tile")].map((el) => el.scrollWidth - el.clientWidth),
    }));
    assert.equal(overflow.page, 0, "the page does not scroll sideways");
    assert.deepEqual(overflow.tiles, [0, 0], "no tile overflows");
    for (const h of await page.locator(".tile").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))) {
      assert.ok(h >= 44, "tiles are at least 44px tall");
    }
  });
}
