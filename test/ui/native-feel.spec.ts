import assert from "node:assert/strict";
import test from "node:test";
import type { BrowserContext, Page } from "playwright-core";
import { useLoaner } from "./harness.js";
import { skipWhatsNew } from "./whats-new-seen.js";

const loaner = useLoaner();

async function call(method: string, url: string, token: string | null, body?: unknown): Promise<any> {
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${loaner.baseUrl}${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.ok(res.ok, `${method} ${url} -> ${res.status}`);
  return res.json();
}

/** One person in one group with `count` items, so Browse is taller than the phone. Fake data only. */
async function seed(name: string, count = 14) {
  const person = await call("POST", "/api/auth/start", null, { name, email: `${name.toLowerCase()}@example.com` });
  const { group } = await call("POST", "/api/groups", person.token, { name: "Flat 3B" });
  for (let i = 1; i <= count; i++) {
    await call("POST", "/api/items", person.token, { name: `Item ${String(i).padStart(2, "0")}`, note: "", donation: null, groupIds: [group.id] });
  }
  return person.token as string;
}

/** A signed-in phone. `navLog` collects every value html[data-ak-nav] takes, since it only lives for one transition. */
async function signedIn(token: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await loaner.phone();
  await ctx.addInitScript((t) => localStorage.setItem("loaner_token", t), token);
  await ctx.addInitScript(() => {
    (window as any).__nav = [];
    new MutationObserver(() => {
      const value = document.documentElement.getAttribute("data-ak-nav");
      if (value) (window as any).__nav.push(value);
    }).observe(document, { attributes: true, attributeFilter: ["data-ak-nav"], subtree: true });
  });
  await skipWhatsNew(ctx);
  const page = await ctx.newPage();
  return { ctx, page };
}

const tab = (page: Page, name: string) => page.locator(".ak-tabbar").getByRole("button", { name });
const scrollY = (page: Page) => page.evaluate(() => Math.round(window.scrollY));

test("native feel: html classes, glass tab bar, and a large title that collapses into the navbar", { timeout: 60_000 }, async () => {
  const { ctx, page } = await signedIn(await seed("Ana"));
  await page.goto(`${loaner.baseUrl}/app`);
  await page.locator("button.tile").first().waitFor();

  const html = await page.evaluate(() => ({ native: document.documentElement.classList.contains("ak-native"), noBounce: document.documentElement.classList.contains("ak-no-bounce") }));
  assert.deepEqual(html, { native: true, noBounce: true });
  assert.notEqual(await page.locator(".ak-tabbar").evaluate((el) => getComputedStyle(el).backdropFilter), "none", "the tab bar is glass");

  const title = page.getByRole("heading", { level: 1, name: "Browse" });
  await title.waitFor();
  assert.equal(await title.getAttribute("class"), "ak-large-title");
  assert.equal(await page.locator(".ak-navbar.ak-collapsed").count(), 0, "at the top the navbar title is hidden");
  assert.ok(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight + 300), "Browse is taller than the phone");

  await page.evaluate(() => window.scrollTo(0, 400));
  await page.locator(".ak-navbar.ak-collapsed").waitFor();
  const bar = await page.locator(".ak-navbar").boundingBox();
  assert.ok(bar && Math.abs(bar.y) < 1, "the navbar stays pinned to the top");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() => !document.querySelector(".ak-navbar.ak-collapsed"));
  await ctx.close();
});

test("lists: skeletons on a first visit, then the saved copy shows at once before the fresh fetch lands", { timeout: 60_000 }, async () => {
  const { ctx, page } = await signedIn(await seed("Bo", 4));
  let delivered = 0;
  await page.route("**/api/groups/*/items*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
    delivered++;
  });

  await page.goto(`${loaner.baseUrl}/app`);
  await page.locator('[aria-busy="true"] .ak-skeleton').first().waitFor({ timeout: 1000 });
  assert.equal(await page.locator("button.tile").count(), 0, "skeletons stand in for the tiles");
  assert.equal(await page.locator(".ak-skeleton").first().getAttribute("aria-hidden"), null, "the shimmer box itself is plain");
  assert.equal(await page.locator(".skel-tile").first().getAttribute("aria-hidden"), "true", "the placeholder is hidden from screen readers");
  await page.locator("button.tile").first().waitFor();
  assert.equal(await page.locator("button.tile").count(), 4);
  assert.equal(await page.locator('[aria-busy="true"]').count(), 0, "busy is cleared once the tiles are in");

  // Away and back: the tiles come from the saved copy while the new fetch is still out.
  await tab(page, "You").click();
  await page.getByRole("heading", { level: 1, name: "You" }).waitFor();
  const before = delivered;
  await tab(page, "Browse").click();
  await page.locator("button.tile").first().waitFor({ timeout: 700 });
  assert.equal(delivered, before, "tiles showed before the fresh response was delivered");
  assert.equal(await page.locator("button.tile").count(), 4);
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
  await ctx.close();
});

test("lists: a failed first load says so and offers Try again", { timeout: 60_000 }, async () => {
  const { ctx, page } = await signedIn(await seed("Cy", 2));
  let fail = true;
  await page.route("**/api/groups/*/items*", (route) => (fail ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Server hiccup" }) }) : route.continue()));
  await page.goto(`${loaner.baseUrl}/app`);
  await page.getByRole("alert").filter({ hasText: "Server hiccup" }).waitFor();
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await page.locator("button.tile").first().waitFor();
  assert.equal(await page.locator("button.tile").count(), 2);
  await ctx.close();
});

test("tab bar: tapping the active tab scrolls to the top, or leaves a sub screen for the tab root, and each tab keeps its scroll", { timeout: 60_000 }, async () => {
  const { ctx, page } = await signedIn(await seed("Di"));
  await page.goto(`${loaner.baseUrl}/app`);
  await page.locator("button.tile").first().waitFor();

  await page.evaluate(() => window.scrollTo(0, 500));
  assert.ok((await scrollY(page)) > 400);
  await tab(page, "Browse").click();
  await page.waitForFunction(() => window.scrollY === 0);
  assert.ok(["", "#/browse"].includes(new URL(page.url()).hash), "a root reselect stays at the tab root");

  // Browse keeps its place while another tab is open.
  await page.evaluate(() => window.scrollTo(0, 300));
  const kept = await scrollY(page);
  await tab(page, "You").click();
  await page.getByRole("heading", { level: 1, name: "You" }).waitFor();
  assert.ok((await scrollY(page)) < 50, "You starts at the top");
  await tab(page, "Browse").click();
  await page.locator("button.tile").first().waitFor();
  await page.waitForFunction((y) => Math.abs(window.scrollY - y) < 5, kept);

  // On an item, tapping Browse returns to the Browse root.
  await page.locator("button.tile", { hasText: "Item 03" }).click();
  await page.getByRole("heading", { level: 1, name: "Item 03" }).waitFor();
  await tab(page, "Browse").click();
  await page.getByRole("heading", { level: 1, name: "Browse" }).waitFor();
  assert.equal(new URL(page.url()).hash, "#/browse");
  await ctx.close();
});

test("page transitions: a deeper screen pushes, going back pops, a tab switch does not slide", { timeout: 60_000 }, async () => {
  const { ctx, page } = await signedIn(await seed("Ed", 4));
  await page.goto(`${loaner.baseUrl}/app`);
  await page.locator("button.tile").first().waitFor();
  const navLog = () => page.evaluate(() => [...(window as any).__nav] as string[]);
  assert.deepEqual(await navLog(), [], "the first paint does not animate");

  await tab(page, "You").click();
  await page.getByRole("heading", { level: 1, name: "You" }).waitFor();
  await tab(page, "Browse").click();
  await page.locator("button.tile").first().waitFor();
  assert.deepEqual(await navLog(), [], "switching tabs is a plain swap");

  await page.locator("button.tile", { hasText: "Item 02" }).click();
  await page.getByRole("heading", { level: 1, name: "Item 02" }).waitFor();
  assert.deepEqual(await navLog(), ["push"]);

  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("heading", { level: 1, name: "Browse" }).waitFor();
  assert.deepEqual(await navLog(), ["push", "pop"]);
  await page.waitForFunction(() => !document.documentElement.hasAttribute("data-ak-nav"));
  await ctx.close();
});

test("sheets: the What's new list scales the app behind it and still closes with Done", { timeout: 60_000 }, async () => {
  const { ctx, page } = await signedIn(await seed("Flo", 2));
  await page.goto(`${loaner.baseUrl}/app#/you`);
  await page.locator("#open-whats-new").click();
  const sheet = page.getByRole("dialog", { name: "What's new" });
  await sheet.waitFor();
  await page.waitForFunction(() => document.documentElement.classList.contains("ak-sheet-scaled"));
  assert.equal(await page.locator("#root").evaluate((el) => el.classList.contains("ak-sheet-behind")), true);
  assert.equal(await page.locator(".ak-tabbar").evaluate((el) => !document.getElementById("root")!.contains(el)), true, "the tab bar is outside the scaled root");

  // It opens full, so the Done button is on screen and reachable.
  const done = sheet.getByRole("button", { name: "Done" });
  await page.waitForFunction(() => {
    const el = [...document.querySelectorAll("button")].find((b) => b.textContent === "Done");
    return !!el && el.getBoundingClientRect().bottom <= innerHeight && !document.querySelector(".ak-sheet")!.getAnimations().length;
  });
  const box = await done.boundingBox();
  assert.ok(box && box.y + box.height <= 844, `Done is inside the viewport (${JSON.stringify(box)})`);
  await done.click();
  await sheet.waitFor({ state: "detached" });
  await page.waitForFunction(() => !document.documentElement.classList.contains("ak-sheet-scaled") && !document.getElementById("root")!.classList.contains("ak-sheet-behind"));
  await ctx.close();
});

test("a new service worker shows an update bar, and Reload swaps it in with one reload", { timeout: 90_000 }, async () => {
  const { ctx, page } = await signedIn(await seed("Gus", 2));
  // The page first installs an older build (the real file with another cache version). Then the route goes away,
  // so the update check fetches the real sw.js: different bytes, a new worker, as after a deploy.
  await ctx.route("**/sw.js", async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, body: (await res.text()).replace('const VERSION = "v24"', 'const VERSION = "v24-old"') });
  });
  await ctx.addInitScript(() => sessionStorage.setItem("loads", String(Number(sessionStorage.getItem("loads") || 0) + 1)));

  await page.goto(`${loaner.baseUrl}/app`);
  await page.locator("button.tile").first().waitFor();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, undefined, { timeout: 30_000 });
  assert.equal(await page.locator("#sw-update").count(), 0, "a first install is not an update");
  assert.deepEqual(await page.evaluate(() => caches.keys()), ["loaner-shell-v24-old"]);

  await ctx.unroute("**/sw.js");
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
  const bar = page.locator("#sw-update");
  await bar.waitFor({ timeout: 15_000 });
  assert.match((await bar.textContent()) ?? "", /new version is ready/i);
  assert.equal(await page.evaluate(() => sessionStorage.getItem("loads")), "1", "nothing reloaded by itself");

  await bar.getByRole("button", { name: "Reload" }).click();
  await page.waitForFunction(() => sessionStorage.getItem("loads") === "2", undefined, { timeout: 30_000 });
  await page.locator("button.tile").first().waitFor();
  await page.waitForFunction(async () => (await caches.keys()).join() === "loaner-shell-v24", undefined, { timeout: 30_000 });
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(() => sessionStorage.getItem("loads")), "2", "exactly one reload");
  assert.equal(await page.locator("#sw-update").count(), 0, "the bar is gone on the new version");
  await ctx.close();
});
