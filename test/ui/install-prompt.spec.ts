import assert from "node:assert/strict";
import test from "node:test";
import type { BrowserContext, Page } from "playwright-core";
import { useLoaner } from "./harness.js";

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const loaner = useLoaner();

const bannerOf = (page: Page) => page.getByRole("region", { name: "Install Loan some" });

/** Signs up through the UI and lands on the screen with no groups yet, a tabbed screen. */
async function signUp(page: Page, name: string) {
  await page.goto(loaner.baseUrl);
  await page.locator("#name").fill(name);
  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByRole("heading", { name: "No groups yet" }).waitFor();
}

/** Fires a stand-in beforeinstallprompt. Records prompt() calls on window.__prompts. */
// Written as source strings: functions passed to the page would pick up tsx's __name helper, which the page lacks.
const fireInstallEvent = (page: Page, outcome: "accepted" | "dismissed") =>
  page.evaluate<boolean>(`(() => {
    window.__prompts = window.__prompts || 0;
    const event = new Event("beforeinstallprompt", { cancelable: true });
    event.prompt = function () { window.__prompts += 1; return Promise.resolve(); };
    event.userChoice = Promise.resolve({ outcome: ${JSON.stringify(outcome)}, platform: "web" });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })()`);

const promptCalls = (page: Page) => page.evaluate(() => (window as unknown as { __prompts?: number }).__prompts || 0);

async function open(context?: BrowserContext) {
  const ctx = context ?? (await loaner.phone());
  return { ctx, page: await ctx.newPage() };
}

test("after sign-up the install prompt is on screen, with a close button and a name", { timeout: 60_000 }, async () => {
  const { ctx, page } = await open();
  await signUp(page, "Ines");
  const banner = bannerOf(page);
  await banner.waitFor();
  assert.equal(await page.locator("#install-prompt").count(), 1);
  await banner.getByText("Install Loan some", { exact: true }).waitFor();
  await banner.getByRole("button", { name: "Not now" }).waitFor();
  // The app behind it still works: the tab bar buttons are there and the group button is clickable.
  await page.locator(".tabbar").getByRole("button", { name: "You" }).click();
  await page.getByRole("heading", { level: 1, name: "You" }).waitFor();
  assert.equal(await page.locator("#install-prompt").count(), 1, "still one copy after navigating");
  await ctx.close();
});

test("Android: the Install button appears when beforeinstallprompt arrives, prompts, and appinstalled removes the banner", { timeout: 60_000 }, async () => {
  const { ctx, page } = await open();
  await signUp(page, "Ari");
  const banner = bannerOf(page);
  await banner.waitFor();

  const prevented = await fireInstallEvent(page, "dismissed");
  assert.equal(prevented, true, "the event is kept, so preventDefault was called");
  const install = banner.getByRole("button", { name: "Install", exact: true });
  await install.waitFor();
  await install.click();
  await page.waitForFunction(() => ((window as unknown as { __prompts?: number }).__prompts || 0) === 1);
  assert.equal(await promptCalls(page), 1);
  // A dismissed choice leaves the banner up, without a dead Install button.
  await banner.waitFor();
  assert.equal(await banner.getByRole("button", { name: "Install", exact: true }).count(), 0);

  // A later event brings the button back, and appinstalled removes the banner for good.
  await fireInstallEvent(page, "dismissed");
  await banner.getByRole("button", { name: "Install", exact: true }).waitFor();
  await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
  await banner.waitFor({ state: "detached" });
  await page.locator(".tabbar").getByRole("button", { name: "You" }).click();
  await page.getByRole("heading", { level: 1, name: "You" }).waitFor();
  assert.equal(await page.locator("#install-prompt").count(), 0, "stays hidden after navigation");
  await ctx.close();
});

test("Android: an accepted install choice hides the banner", { timeout: 60_000 }, async () => {
  const { ctx, page } = await open();
  await signUp(page, "Ada");
  const banner = bannerOf(page);
  await banner.waitFor();
  await fireInstallEvent(page, "accepted");
  await banner.getByRole("button", { name: "Install", exact: true }).click();
  await banner.waitFor({ state: "detached" });
  assert.equal(await promptCalls(page), 1);
  await ctx.close();
});

test("iOS Safari: shows Share then Add to Home Screen with a share icon, and no Install button", { timeout: 60_000 }, async () => {
  const ctx = await loaner.phone({ userAgent: IPHONE_UA });
  const { page } = await open(ctx);
  await signUp(page, "Iris");
  const banner = bannerOf(page);
  await banner.waitFor();
  await banner.getByText("Tap Share", { exact: false }).waitFor();
  await banner.getByText("Add to Home Screen", { exact: false }).waitFor();
  assert.equal(await banner.locator(".ip-steps svg").count(), 1, "the share icon");
  // Even if a beforeinstallprompt shows up, iOS has no working Install button.
  await fireInstallEvent(page, "accepted");
  assert.equal(await banner.getByRole("button", { name: "Install", exact: true }).count(), 0);
  assert.equal(await promptCalls(page), 0);
  await ctx.close();
});

test("closing hides it for this visit, across navigation, and a new visit shows it again", { timeout: 90_000 }, async () => {
  const { ctx, page } = await open();
  await signUp(page, "Dee");
  const banner = bannerOf(page);
  await banner.waitFor();
  await banner.getByRole("button", { name: "Not now" }).click();
  await banner.waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => sessionStorage.getItem("loaner_install_prompt_dismissed")), "1");
  assert.equal(await page.evaluate(() => localStorage.getItem("loaner_install_prompt_dismissed")), null, "not kept in localStorage");

  for (const tab of ["My items", "Requests", "Alerts", "You", "Browse"]) {
    await page.locator(".tabbar").getByRole("button", { name: tab, exact: true }).click();
    await page.waitForFunction((label) => document.querySelector(".tabbar [aria-current]")?.textContent?.includes(label), tab);
  }
  assert.equal(await page.locator("#install-prompt").count(), 0, "stays gone while navigating");

  // A reload in the same session keeps it closed. A new visit has empty sessionStorage, so it comes back.
  await page.reload();
  await page.getByRole("heading", { name: "No groups yet" }).waitFor();
  assert.equal(await page.locator("#install-prompt").count(), 0);
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await banner.waitFor();

  // A fresh page in the same signed-in context, with its own session, also shows it.
  const second = await ctx.newPage();
  await second.goto(loaner.baseUrl);
  await bannerOf(second).waitFor();
  await ctx.close();
});

test("the installed app never shows it, for display-mode standalone and navigator.standalone", { timeout: 90_000 }, async () => {
  const media = await open();
  await media.ctx.addInitScript(`(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = function (query) {
      if (!query.includes("display-mode: standalone")) return original(query);
      return { matches: true, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } };
    };
  })()`);
  await signUp(media.page, "Sam");
  await media.page.waitForTimeout(600);
  assert.equal(await media.page.locator("#install-prompt").count(), 0, "display-mode standalone");
  await fireInstallEvent(media.page, "accepted");
  assert.equal(await media.page.locator("#install-prompt").count(), 0, "not even when the install event arrives");
  await media.ctx.close();

  const ios = await open(await loaner.phone({ userAgent: IPHONE_UA }));
  await ios.ctx.addInitScript(`Object.defineProperty(navigator, "standalone", { value: true, configurable: true })`);
  await signUp(ios.page, "Ines");
  await ios.page.waitForTimeout(600);
  assert.equal(await ios.page.locator("#install-prompt").count(), 0, "navigator.standalone");
  await ios.ctx.close();
});

test("the banner stays clear of the tab bar and leaves the buttons reachable", { timeout: 60_000 }, async () => {
  const { ctx, page } = await open();
  await signUp(page, "Bea");
  await bannerOf(page).waitFor();
  const [banner, tabbar] = await Promise.all([bannerOf(page).boundingBox(), page.locator(".tabbar").boundingBox()]);
  assert.ok(banner && tabbar);
  const apart = banner.y + banner.height <= tabbar.y || tabbar.y + tabbar.height <= banner.y;
  assert.ok(apart, `banner ${JSON.stringify(banner)} overlaps tab bar ${JSON.stringify(tabbar)}`);
  assert.ok(banner.x >= 0 && banner.x + banner.width <= 390, "fits the phone width");

  // The tab bar's centre points hit the tab buttons, not the banner.
  for (const label of ["Browse", "My items", "Requests", "Alerts", "You"]) {
    const button = page.locator(".tabbar").getByRole("button", { name: label, exact: true });
    const box = (await button.boundingBox())!;
    const hit = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest(".tabbar"), { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    assert.ok(hit, `${label} is not covered`);
  }
  await ctx.close();
});

test("the signed-out welcome screen shows it without covering Get started", { timeout: 60_000 }, async () => {
  const { ctx, page } = await open();
  await page.goto(loaner.baseUrl);
  await bannerOf(page).waitFor();
  const start = page.getByRole("button", { name: "Get started" });
  const box = (await start.boundingBox())!;
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.textContent, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  assert.equal(hit, "Get started");
  await ctx.close();
});
