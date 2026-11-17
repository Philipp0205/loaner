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

/** Lena lists a drill with a photo and a ladder without one. Max is a member of the group. */
async function seed() {
  const lena = await call("POST", "/api/auth/start", null, { name: "Lena", email: "lena@example.com" });
  const max = await call("POST", "/api/auth/start", null, { name: "Max", email: "max@example.com" });
  const { group } = await call("POST", "/api/groups", lena.token, { name: "WG Lissabon" });
  await call("POST", `/api/invites/${group.inviteCode}/join`, max.token);
  const drill = (await call("POST", "/api/items", lena.token, { name: "Cordless drill", note: "", donation: null, groupIds: [group.id] })).item;
  const ladder = (await call("POST", "/api/items", lena.token, { name: "Aluminium ladder", note: "", donation: null, groupIds: [group.id] })).item;
  await call("PUT", `/api/items/${drill.id}/photo`, lena.token, undefined, solidPng(800, 600, [190, 60, 50]));
  return { max, drill, ladder };
}

async function openItem(token: string, id: number | string, colorScheme: "light" | "dark" = "light"): Promise<Page> {
  const ctx = await loaner.phone({ colorScheme });
  await ctx.addInitScript((t) => localStorage.setItem("loaner_token", t), token);
  await skipWhatsNew(ctx);
  const page = await ctx.newPage();
  await page.setViewportSize(SIZE);
  await page.goto(`${loaner.baseUrl}/#/item/${id}`);
  await page.waitForFunction(() => {
    const img = document.querySelector<HTMLImageElement>("img.photo.big");
    return !!img && img.naturalWidth > 0;
  });
  return page;
}

const viewer = (page: Page) => page.locator(".pv");
const hash = (page: Page) => page.evaluate(() => location.hash);

test("tapping the item photo opens a fullscreen dialog that fits the photo on a dark backdrop", { timeout: 60_000 }, async () => {
  const { max, drill } = await seed();
  const page = await openItem(max.token, drill.id);
  const trigger = page.locator("img.photo.big");
  assert.equal(await trigger.getAttribute("aria-label"), "View photo of Cordless drill");
  assert.equal(await viewer(page).count(), 0);

  await trigger.tap();
  await viewer(page).waitFor();
  const dialog = viewer(page);
  assert.equal(await dialog.getAttribute("role"), "dialog");
  assert.equal(await dialog.getAttribute("aria-modal"), "true");
  assert.equal(await dialog.getAttribute("aria-label"), "Photo of Cordless drill");

  const box = await dialog.boundingBox();
  assert.deepEqual({ w: box?.width, h: box?.height, x: box?.x, y: box?.y }, { w: SIZE.width, h: SIZE.height, x: 0, y: 0 }, "covers the viewport");
  assert.equal(await dialog.evaluate((el) => getComputedStyle(el).backgroundColor), "rgb(0, 0, 0)", "dark backdrop");

  const img = await page.locator(".pv-img").evaluate((el: HTMLImageElement) => {
    const r = el.getBoundingClientRect();
    return { fit: getComputedStyle(el).objectFit, w: r.width, h: r.height, nw: el.naturalWidth, nh: el.naturalHeight, src: el.src };
  });
  assert.equal(img.fit, "contain");
  assert.ok(img.nw > 0, "the viewer image loaded");
  assert.ok(img.src.startsWith("blob:"), "it shows the photo's blob url");
  assert.ok(img.w === SIZE.width && img.h === SIZE.height, "the image box fills the screen, the photo is letterboxed inside it");
  assert.ok(Math.abs(img.nw / img.nh - 4 / 3) < 0.01, "the file keeps its 4:3 ratio and is not cropped");

  const closeBtn = page.locator(".pv-close");
  assert.equal(await closeBtn.getAttribute("aria-label"), "Close photo");
  const c = await closeBtn.boundingBox();
  assert.ok(c && c.width >= 44 && c.height >= 44, "close target is at least 44px");
  assert.ok(c.y >= 0 && c.x + c.width <= SIZE.width, "close button is on screen");
  assert.equal(await page.evaluate(() => document.activeElement?.className), "pv-close", "focus moves to the close button");
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).overflow), "hidden", "body scroll is locked");
});

test("the close button closes the viewer, keeps you on the item and gives focus back to the photo", { timeout: 60_000 }, async () => {
  const { max, drill } = await seed();
  const page = await openItem(max.token, drill.id);
  const before = await hash(page);
  await page.locator("img.photo.big").tap();
  await viewer(page).waitFor();
  await page.locator(".pv-close").tap();
  await viewer(page).waitFor({ state: "detached" });
  assert.equal(await hash(page), before);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "View photo of Cordless drill");
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).overflow), "visible", "body scroll is back");
  await page.locator("h1", { hasText: "Cordless drill" }).waitFor();
});

test("a tap on the backdrop closes it, a tap on the photo does not", { timeout: 60_000 }, async () => {
  const { max, drill } = await seed();
  const page = await openItem(max.token, drill.id);
  await page.locator("img.photo.big").tap();
  await viewer(page).waitFor();
  await page.touchscreen.tap(SIZE.width / 2, SIZE.height / 2);
  await page.waitForTimeout(300);
  assert.equal(await viewer(page).count(), 1, "tapping the photo keeps it open");
  await page.touchscreen.tap(SIZE.width / 2, 120);
  await viewer(page).waitFor({ state: "detached" });
  assert.equal(await hash(page), `#/item/${drill.id}`);
  await page.locator("h1", { hasText: "Cordless drill" }).waitFor();
});

test("the Back button closes the viewer and leaves you on the item", { timeout: 60_000 }, async () => {
  const { max, drill } = await seed();
  const page = await openItem(max.token, drill.id);
  await page.locator("img.photo.big").tap();
  await viewer(page).waitFor();
  await page.goBack();
  await viewer(page).waitFor({ state: "detached" });
  assert.equal(await hash(page), `#/item/${drill.id}`);
  await page.locator("h1", { hasText: "Cordless drill" }).waitFor();
  // And it opens again afterwards.
  await page.locator("img.photo.big").tap();
  await viewer(page).waitFor();
});

test("Escape closes the viewer", { timeout: 60_000 }, async () => {
  const { max, drill } = await seed();
  const page = await openItem(max.token, drill.id);
  await page.locator("img.photo.big").tap();
  await viewer(page).waitFor();
  await page.keyboard.press("Escape");
  await viewer(page).waitFor({ state: "detached" });
  assert.equal(await hash(page), `#/item/${drill.id}`);
});

test("the close button stays visible on a dark phone too", { timeout: 60_000 }, async () => {
  const { max, drill } = await seed();
  const page = await openItem(max.token, drill.id, "dark");
  await page.locator("img.photo.big").tap();
  await viewer(page).waitFor();
  assert.equal(await viewer(page).evaluate((el) => getComputedStyle(el).backgroundColor), "rgb(0, 0, 0)");
  assert.equal(await page.locator(".pv-close").evaluate((el) => getComputedStyle(el).color), "rgb(255, 255, 255)");
  await page.locator(".pv-close").tap();
  await viewer(page).waitFor({ state: "detached" });
});

test("an item with no photo shows a placeholder that is not a control, and browse tiles do not open the viewer", { timeout: 60_000 }, async () => {
  const { max, ladder } = await seed();
  const ctx = await loaner.phone();
  await ctx.addInitScript((t) => localStorage.setItem("loaner_token", t), max.token);
  await skipWhatsNew(ctx);
  const p = await ctx.newPage();
  await p.setViewportSize(SIZE);
  await p.goto(`${loaner.baseUrl}/#/item/${ladder.id}`);
  const none = p.locator(".hero .photo.none");
  await none.waitFor();
  assert.equal(await none.getAttribute("role"), null);
  assert.equal(await none.getAttribute("tabindex"), null);
  await none.click();
  await p.waitForTimeout(300);
  assert.equal(await viewer(p).count(), 0, "tapping the placeholder opens nothing");
  assert.equal(await p.locator(".hero button, .hero [role=button]").count(), 1, "only the Back button is a control in the hero");

  await p.goto(`${loaner.baseUrl}/#/`);
  await p.locator("button.tile", { hasText: "Cordless drill" }).waitFor();
  await p.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>(".tile img.photo")].some((i) => i.naturalWidth > 0));
  await p.locator(".tile img.photo").first().evaluate((el) => (el as HTMLElement).click());
  await p.waitForTimeout(200);
  assert.equal(await viewer(p).count(), 0, "a tile photo does not open the viewer");
});
