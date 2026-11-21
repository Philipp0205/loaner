import assert from "node:assert/strict";
import test from "node:test";
import type { BrowserContext, CDPSession, Page } from "playwright-core";
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

/** Two friends in one group. Ana owns one item. Fake data only. */
async function seed(suffix: string) {
  const ana = await call("POST", "/api/auth/start", null, { name: `Ana${suffix}`, email: `ana${suffix.toLowerCase()}@example.com` });
  const ben = await call("POST", "/api/auth/start", null, { name: `Ben${suffix}`, email: `ben${suffix.toLowerCase()}@example.com` });
  const { group } = await call("POST", "/api/groups", ana.token, { name: "Flat 3B" });
  await call("POST", `/api/invites/${group.inviteCode}/join`, ben.token);
  const add = (token: string, name: string) => call("POST", "/api/items", token, { name, note: "", donation: null, groupIds: [group.id] });
  const drill = (await add(ana.token, "Cordless drill")).item;
  return { ana: ana.token as string, ben: ben.token as string, group, drill, add };
}

/** A signed-in phone at /app#/route with a marker on window, so a full reload would be seen. */
async function open(token: string, route: string): Promise<{ ctx: BrowserContext; page: Page; cdp: CDPSession }> {
  const ctx = await loaner.phone();
  await ctx.addInitScript((t) => localStorage.setItem("loaner_token", t), token);
  await skipWhatsNew(ctx);
  const page = await ctx.newPage();
  await page.goto(`${loaner.baseUrl}/app${route}`);
  await page.waitForFunction(() => !!document.querySelector(".ak-screen"));
  await page.evaluate(() => { (window as any).__marker = "same page"; });
  return { ctx, page, cdp: await ctx.newCDPSession(page) };
}

const marker = (page: Page) => page.evaluate(() => (window as any).__marker);
const touch = (cdp: CDPSession, type: "touchStart" | "touchMove" | "touchEnd", y?: number) =>
  cdp.send("Input.dispatchTouchEvent", { type, touchPoints: y === undefined ? [] : [{ x: 195, y }] });

/** A real finger: down at y=200, dragged down `distance` px in steps, held (not lifted) unless `lift`. */
async function drag(cdp: CDPSession, distance: number, lift: boolean) {
  await touch(cdp, "touchStart", 200);
  for (let step = 1; step <= 8; step++) await touch(cdp, "touchMove", 200 + (distance * step) / 8);
  if (lift) await touch(cdp, "touchEnd");
}

const tiles = (page: Page) => page.locator("button.tile");

test("pull to refresh on Browse: the spinner follows the finger, a new item appears, and the page is not reloaded", { timeout: 90_000 }, async () => {
  const { ana, ben, add } = await seed("A");
  const { ctx, page, cdp } = await open(ben, "#/browse");
  await tiles(page).first().waitFor();
  assert.equal(await tiles(page).count(), 1);

  // Ana lists a ladder from another session. This phone does not know yet.
  await add(ana, "Aluminium ladder");
  assert.equal(await tiles(page).count(), 1, "nothing refreshes by itself");

  // Slow the list a little so the loading spinner can be seen.
  await page.route("**/api/groups/*/items*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route.continue();
  });

  await drag(cdp, 200, false);
  const pulling = page.locator(".ak-ptr.ak-ptr-pulling");
  await pulling.waitFor();
  assert.ok(Number(await pulling.evaluate((el) => getComputedStyle(el).opacity)) > 0.5, "the indicator is visible mid-pull");
  assert.equal(await page.locator(".ak-ptr").count(), 1, "one indicator");
  assert.equal(await page.evaluate(() => document.documentElement.style.overscrollBehaviorY), "contain");

  await touch(cdp, "touchEnd");
  await page.locator(".ak-ptr.ak-ptr-loading").waitFor();
  assert.equal(await page.locator(".ak-ptr.ak-ptr-pulling").count(), 0);
  await tiles(page).nth(1).waitFor();
  assert.equal(await tiles(page).count(), 2);
  await page.getByText("Aluminium ladder").waitFor();
  await page.waitForFunction(() => !document.querySelector(".ak-ptr-loading") && !document.querySelector(".ak-ptr-pulling"));
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".ak-ptr")!).opacity === "0");

  assert.equal(await marker(page), "same page", "no full page reload");
  assert.equal(await page.locator("nav.ak-tabbar").count(), 1, "one tab bar");
  assert.equal(await page.locator(".ak-ptr").count(), 1, "still one indicator");
  await ctx.close();
});

test("a short pull springs back without refreshing, and a pull from a scrolled page does nothing", { timeout: 90_000 }, async () => {
  const { ana, ben, add } = await seed("B");
  for (let i = 1; i <= 12; i++) await add(ana, `Extra ${String(i).padStart(2, "0")}`);
  const { ctx, page, cdp } = await open(ben, "#/browse");
  await tiles(page).first().waitFor();
  let fetches = 0;
  await page.route("**/api/groups/*/items*", async (route) => {
    fetches++;
    await route.continue();
  });

  // About 60px of finger travel is under the 70px line.
  await drag(cdp, 60, true);
  await page.waitForFunction(() => !document.querySelector(".ak-ptr-pulling") && !document.querySelector(".ak-ptr-loading"));
  await page.waitForTimeout(400);
  assert.equal(fetches, 0, "nothing was fetched");

  // Scrolled down: a drag is a normal scroll back up, not a pull.
  await page.evaluate(() => window.scrollTo(0, 500));
  await page.waitForFunction(() => window.scrollY > 400);
  await drag(cdp, 200, true);
  await page.waitForTimeout(400);
  assert.equal(await page.locator(".ak-ptr-pulling, .ak-ptr-loading").count(), 0);
  assert.equal(fetches, 0, "nothing was fetched");
  assert.equal(await marker(page), "same page");
  await ctx.close();
});

test("pull to refresh on Requests: a request made elsewhere shows up, with fresh shared state, and a pull on a form leaves it alone", { timeout: 90_000 }, async () => {
  const { ana, ben, drill } = await seed("C");
  const { ctx, page, cdp } = await open(ana, "#/requests");
  await page.getByText("No requests yet").waitFor();

  const { today } = await call("GET", "/api/me", ben);
  await call("POST", `/api/items/${drill.id}/requests`, ben, { from: today, until: today, message: "For a shelf" });
  await drag(cdp, 200, true);
  await page.locator('[data-request][data-status="pending"]').waitFor();
  await page.getByText("For a shelf").waitFor();
  assert.equal(await page.locator("[data-alerts-bell] .ak-badge").count(), 1, "the unread badge is refreshed too");
  await page.waitForFunction(() => !document.querySelector(".ak-ptr-loading"));
  assert.equal(await marker(page), "same page", "no full page reload");

  // The add item form: a pull must not throw away what was typed.
  await page.evaluate(() => { location.hash = "#/mine/new/form"; });
  const name = page.locator("#item-name");
  await name.waitFor();
  await name.fill("Half typed");
  await drag(cdp, 200, true);
  await page.locator(".ak-ptr-loading").waitFor({ state: "detached" });
  assert.equal(await name.inputValue(), "Half typed", "the form keeps its text");
  assert.equal(await marker(page), "same page");
  await ctx.close();
});

test("the pull is bound only while the signed-in app shows, and never twice", { timeout: 90_000 }, async () => {
  const { ben } = await seed("D");
  const { ctx, page, cdp } = await open(ben, "#/browse");
  // Redraw a few times: still a single bound gesture and a single indicator.
  const tab = (name: string) => page.locator(".ak-tabbar").getByRole("button", { name });
  await tab("You").click();
  await page.getByRole("heading", { level: 1, name: "You" }).waitFor();
  await tab("Browse").click();
  await tiles(page).first().waitFor();
  await drag(cdp, 200, false);
  await page.locator(".ak-ptr-pulling").waitFor();
  assert.equal(await page.locator(".ak-ptr").count(), 1);
  await touch(cdp, "touchEnd");
  await page.waitForFunction(() => !document.querySelector(".ak-ptr-loading") && !document.querySelector(".ak-ptr-pulling"));
  assert.equal(await page.locator(".ak-ptr").count(), 1);

  // The sign-in screen has no pull: the signed-out welcome page binds nothing.
  const out = await loaner.phone();
  const welcome = await out.newPage();
  await welcome.goto(`${loaner.baseUrl}/app`);
  await welcome.locator("#name").waitFor();
  assert.equal(await welcome.evaluate(() => document.documentElement.style.overscrollBehaviorY), "");
  assert.equal(await welcome.locator(".ak-ptr").count(), 0);
  await out.close();
  await ctx.close();
});
