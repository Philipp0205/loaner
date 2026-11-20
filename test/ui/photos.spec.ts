import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "playwright-core";
import { useLoaner } from "./harness.js";
import { solidPng } from "./png.js";
import { skipWhatsNew } from "./whats-new-seen.js";

const loaner = useLoaner();
const SIZE = { width: 390, height: 844 };

async function call(method: string, url: string, token: string | null, body?: unknown, raw?: Buffer): Promise<any> {
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  if (raw) headers["content-type"] = "image/png";
  else if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${loaner.baseUrl}${url}`, { method, headers, body: raw ? new Uint8Array(raw) : body === undefined ? undefined : JSON.stringify(body) });
  assert.ok(res.ok, `${method} ${url} -> ${res.status}`);
  return res.json();
}

const png = (name: string, rgb: [number, number, number]) => ({ name, mimeType: "image/png", buffer: solidPng(60, 40, rgb) });

/** Lena owns a drill with no photo and a ladder with one old style photo. Max is in the group. */
async function seed() {
  const lena = await call("POST", "/api/auth/start", null, { name: "Lena", email: "lena@example.com" });
  const max = await call("POST", "/api/auth/start", null, { name: "Max", email: "max@example.com" });
  const { group } = await call("POST", "/api/groups", lena.token, { name: "WG Lissabon" });
  await call("POST", `/api/invites/${group.inviteCode}/join`, max.token);
  const drill = (await call("POST", "/api/items", lena.token, { name: "Cordless drill", note: "", donation: null, groupIds: [group.id] })).item;
  const ladder = (await call("POST", "/api/items", lena.token, { name: "Aluminium ladder", note: "", donation: null, groupIds: [group.id] })).item;
  await call("PUT", `/api/items/${ladder.id}/photo`, lena.token, undefined, solidPng(800, 600, [60, 90, 190]));
  return { lena, max, drill, ladder };
}

async function open(token: string, hash: string): Promise<Page> {
  const ctx = await loaner.phone({ colorScheme: "light" });
  await ctx.addInitScript((t) => localStorage.setItem("loaner_token", t), token);
  await skipWhatsNew(ctx);
  const page = await ctx.newPage();
  await page.setViewportSize(SIZE);
  await page.goto(`${loaner.baseUrl}/${hash}`);
  return page;
}

test("the owner adds three photos in the form and they save in order", { timeout: 90_000 }, async () => {
  const { lena, drill } = await seed();
  const page = await open(lena.token, `#/mine/edit/${drill.id}`);
  await page.locator("#item-photo").waitFor({ state: "attached" });
  assert.equal(await page.locator("#item-photo").getAttribute("multiple"), "");
  await page.getByText("No photos yet").waitFor();

  await page.locator("#item-photo").setInputFiles([png("a.png", [200, 40, 40]), png("b.png", [40, 200, 40]), png("c.png", [40, 40, 200])]);
  await page.getByText("3 of 6 photos").waitFor();
  assert.equal(await page.locator(".picker-item").count(), 3);
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.locator("[data-gallery]").waitFor();

  const { item } = await call("GET", `/api/items/${drill.id}`, lena.token);
  assert.equal(item.photoIds.length, 3);
  assert.equal(await page.locator(".gal-track img.photo.big").count(), 3);
  assert.equal(await page.locator("[data-gallery-count]").innerText(), "1 / 3");
});

test("the form takes six photos and says so when more are picked", { timeout: 90_000 }, async () => {
  const { lena, drill } = await seed();
  const page = await open(lena.token, `#/mine/edit/${drill.id}`);
  await page.locator("#item-photo").waitFor({ state: "attached" });
  const files = Array.from({ length: 7 }, (_, i) => png(`p${i}.png`, [20 * i, 90, 120]));
  await page.locator("#item-photo").setInputFiles(files);
  await page.getByText("6 of 6 photos").waitFor();
  assert.equal(await page.locator(".picker-item").count(), 6);
  await page.getByText(/Only 6 photos fit/).waitFor();
  assert.equal(await page.locator("#item-photo").isDisabled(), true, "no room for more");
  await page.locator(".picker-remove").first().click();
  await page.getByText("5 of 6 photos").waitFor();
  assert.equal(await page.locator("#item-photo").isDisabled(), false);
});

test("scrolling the gallery updates the counter, and a tap opens the viewer on that photo", { timeout: 90_000 }, async () => {
  const { lena, max, drill } = await seed();
  for (const rgb of [[200, 40, 40], [40, 200, 40], [40, 40, 200]] as const) {
    await call("POST", `/api/items/${drill.id}/photos`, lena.token, undefined, solidPng(800, 600, [...rgb]));
  }
  const page = await open(max.token, `#/item/${drill.id}`);
  await page.locator("[data-gallery]").waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>(".gal-track img")].every((img) => img.naturalWidth > 0));
  const counter = page.locator("[data-gallery-count]");
  assert.equal(await counter.innerText(), "1 / 3");
  assert.equal(await page.locator(".gal-track img").first().getAttribute("aria-label"), "View photo 1 of 3 of Cordless drill");

  await page.locator(".gal-track").evaluate((el) => { el.scrollLeft = el.clientWidth * 2; });
  await page.getByText("3 / 3", { exact: true }).waitFor();

  await page.locator(".gal-track img").nth(2).tap();
  await page.locator(".pv").waitFor();
  assert.equal(await page.locator(".pv-count").innerText(), "3 / 3", "the viewer opens on the photo that was tapped");
  assert.equal(await page.locator(".pv-img").count(), 3);
  await page.locator(".pv-close").tap();
  await page.locator(".pv").waitFor({ state: "detached" });
});

test("a photo removed in the edit form goes away on Save, and not before", { timeout: 90_000 }, async () => {
  const { lena, drill } = await seed();
  for (const rgb of [[200, 40, 40], [40, 200, 40]] as const) {
    await call("POST", `/api/items/${drill.id}/photos`, lena.token, undefined, solidPng(800, 600, [...rgb]));
  }
  const before = (await call("GET", `/api/items/${drill.id}`, lena.token)).item.photoIds as string[];
  const page = await open(lena.token, `#/mine/edit/${drill.id}`);
  await page.getByText("2 of 6 photos").waitFor();
  await page.locator(".picker-remove").first().click();
  await page.getByText("1 of 6 photos").waitFor();
  assert.equal((await call("GET", `/api/items/${drill.id}`, lena.token)).item.photoIds.length, 2, "nothing is deleted until Save");

  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByRole("heading", { level: 1, name: "Cordless drill" }).waitFor();
  const after = (await call("GET", `/api/items/${drill.id}`, lena.token)).item.photoIds as string[];
  assert.deepEqual(after, [before[1]]);
  assert.equal(await page.locator("[data-gallery]").count(), 0, "one photo is shown the old way, with no gallery");
});

test("an item with one old style photo looks as before, with no counter", { timeout: 90_000 }, async () => {
  const { max, ladder } = await seed();
  const page = await open(max.token, `#/item/${ladder.id}`);
  await page.waitForFunction(() => (document.querySelector<HTMLImageElement>("img.photo.big")?.naturalWidth ?? 0) > 0);
  assert.equal(await page.locator("[data-gallery]").count(), 0);
  assert.equal(await page.locator("[data-gallery-count]").count(), 0);
  assert.equal(await page.locator("img.photo.big").getAttribute("aria-label"), "View photo of Aluminium ladder");
  await page.locator("img.photo.big").tap();
  await page.locator(".pv").waitFor();
  assert.equal(await page.locator(".pv-count").count(), 0, "one photo has no counter");
});

test("a donation in words shows on the item page and the tile", { timeout: 90_000 }, async () => {
  const { lena, max, drill } = await seed();
  await call("PATCH", `/api/items/${drill.id}`, lena.token, { donationText: "a beer" });
  const page = await open(max.token, `#/item/${drill.id}`);
  await page.getByText("Suggested donation: a beer", { exact: true }).waitFor();
  await page.goto(`${loaner.baseUrl}/`);
  const tile = page.locator("button.tile", { hasText: "Cordless drill" });
  await tile.waitFor();
  assert.equal(await tile.locator(".donation").innerText(), "Suggested donation: a beer");
});
