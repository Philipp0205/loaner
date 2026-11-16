import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "playwright-core";
import { signUp, useLoaner } from "./harness.js";

const loaner = useLoaner();

const HERO = "Lend things to your friends. Borrow what you need.";

/** Signs up as `name`, makes a group and returns its invite link, read off the You tab. */
async function makeGroup(page: Page, name: string, group: string): Promise<string> {
  await signUp(page, loaner.baseUrl, name);
  await page.getByRole("heading", { name: "No groups yet" }).waitFor();
  await page.locator("#group-name").fill(group);
  await page.getByRole("button", { name: "Create group" }).click();
  await page.locator("#group-switch").waitFor();
  await page.locator(".ak-tabbar").getByRole("button", { name: "You" }).click();
  const link = page.locator(".invite-link").first();
  await link.waitFor();
  return (await link.innerText()).trim();
}

test("a signed-out visitor sees the landing, and Get started reaches the welcome form", { timeout: 60_000 }, async () => {
  const errors: string[] = [];
  const ctx = await loaner.phone();
  const page = await ctx.newPage();
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.goto(`${loaner.baseUrl}/`);
  await page.getByRole("heading", { level: 1, name: HERO }).waitFor();
  const start = page.getByRole("link", { name: "Get started" });
  await start.waitFor();
  assert.equal(await page.locator("#name").count(), 0, "no welcome field on the landing");
  assert.equal(new URL(page.url()).pathname, "/");

  await start.click();
  await page.locator("#name").waitFor();
  assert.equal(new URL(page.url()).pathname, "/app");
  await page.getByRole("button", { name: "Get started" }).waitFor();
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("the recovery link on the landing reaches the recovery form", { timeout: 60_000 }, async () => {
  const ctx = await loaner.phone();
  const page = await ctx.newPage();
  await page.goto(`${loaner.baseUrl}/`);
  await page.getByRole("link", { name: "I have a recovery code" }).click();
  await page.locator("#recover-code").waitFor();
  const url = new URL(page.url());
  assert.equal(url.pathname, "/app");
  assert.equal(url.hash, "#/recover");
  await ctx.close();
});

test("/welcome shows the landing for a signed-out visitor, with both app screenshots loaded", { timeout: 60_000 }, async () => {
  const errors: string[] = [];
  const ctx = await loaner.phone();
  const page = await ctx.newPage();
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.goto(`${loaner.baseUrl}/welcome`);
  await page.getByRole("heading", { level: 1, name: HERO }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/welcome");
  assert.equal(await page.locator("#name").count(), 0, "no welcome field on the landing");

  const shots = page.locator(".hero-phone .phone img");
  assert.equal(await shots.count(), 2, "the hero drill screenshot and the shelf screenshot are in the document");
  await page.waitForFunction(() => [...document.querySelectorAll(".hero-phone img")].every((img) => (img as HTMLImageElement).complete));
  const sizes = await shots.evaluateAll((images) => images.map((img) => ({ src: (img as HTMLImageElement).currentSrc, width: (img as HTMLImageElement).naturalWidth })));
  for (const shot of sizes) assert.ok(shot.width > 0, `${shot.src} loaded`);
  assert.ok(sizes.some((shot) => shot.src.includes("/landing/shelf-")), "the shelf screenshot is shown");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("/welcome still shows the landing for a signed-in user, with no redirect to /app", { timeout: 60_000 }, async () => {
  const ctx = await loaner.phone();
  const page = await ctx.newPage();
  await signUp(page, loaner.baseUrl, "Wen");
  assert.ok(await page.evaluate(() => localStorage.getItem("loaner_token")), "signed in");
  for (const path of ["/welcome", "/welcome/"]) {
    await page.goto(`${loaner.baseUrl}${path}`);
    await page.getByRole("heading", { level: 1, name: HERO }).waitFor();
    assert.equal(new URL(page.url()).pathname, path);
    assert.equal(await page.locator("nav.ak-tabbar").count(), 0, "not the app");
  }
  await ctx.close();
});

test("a signed-in user who opens / lands in the app, not the landing", { timeout: 60_000 }, async () => {
  const ctx = await loaner.phone();
  const page = await ctx.newPage();
  await signUp(page, loaner.baseUrl, "Una");
  await page.goto(`${loaner.baseUrl}/`);
  await page.locator("nav.ak-tabbar").waitFor();
  assert.equal(new URL(page.url()).pathname, "/app");
  assert.equal(await page.getByRole("heading", { level: 1, name: HERO }).count(), 0, "the landing is not shown");
  await ctx.close();
});

test("invite links still work for a signed-out person, a bad one says so, and the landing form reaches the join screen", { timeout: 90_000 }, async () => {
  const errors: string[] = [];
  const hostCtx = await loaner.phone();
  const host = await hostCtx.newPage();
  const invite = await makeGroup(host, "Hana", "Flat 3B");
  const code = new URL(invite).pathname.split("/").filter(Boolean).pop()!;
  assert.match(invite, /\/join\//);

  // A signed-out person opens the invite and joins.
  const guestCtx = await loaner.phone();
  const guest = await guestCtx.newPage();
  guest.on("pageerror", (error) => errors.push(String(error)));
  await guest.goto(invite);
  await guest.getByRole("heading", { name: "Join Flat 3B?" }).waitFor();
  assert.equal(await guest.getByRole("heading", { level: 1, name: HERO }).count(), 0, "not the landing");
  await guest.locator("#name").fill("Gus");
  await guest.locator("#email").fill("gus@example.com");
  await guest.getByRole("button", { name: "Join Flat 3B" }).click();
  await guest.locator("nav.ak-tabbar").waitFor();

  // A bad invite is the app's own message, not the landing.
  const strayCtx = await loaner.phone();
  const stray = await strayCtx.newPage();
  await stray.goto(`${loaner.baseUrl}/join/NOPENOPE12`);
  await stray.getByText("This invite link does not work").waitFor();
  assert.equal(await stray.getByRole("heading", { level: 1, name: HERO }).count(), 0, "not the landing");

  // The landing's own invite form: a bad code, then the real one.
  await stray.goto(`${loaner.baseUrl}/`);
  await stray.getByRole("heading", { level: 1, name: HERO }).waitFor();
  await stray.locator("#invite-code").fill("   ");
  await stray.getByRole("button", { name: "Join", exact: true }).click();
  await stray.getByText("Enter the code from your invite link.").waitFor();
  await stray.locator("#invite-code").fill(code);
  await stray.getByRole("button", { name: "Join", exact: true }).click();
  await stray.getByRole("heading", { name: "Join Flat 3B?" }).waitFor();
  assert.equal(new URL(stray.url()).pathname, `/join/${code.toUpperCase()}`);

  assert.deepEqual(errors, []);
  await hostCtx.close();
  await guestCtx.close();
  await strayCtx.close();
});

for (const scheme of ["light", "dark"] as const) {
  test(`the landing is readable in ${scheme} mode`, { timeout: 60_000 }, async () => {
    const ctx = await loaner.phone({ colorScheme: scheme });
    const page = await ctx.newPage();
    await page.goto(`${loaner.baseUrl}/`);
    await page.getByRole("heading", { level: 1, name: HERO }).waitFor();
    const colours = await page.evaluate(() => {
      const heading = getComputedStyle(document.querySelector("h1")!);
      return {
        page: getComputedStyle(document.body).backgroundColor,
        root: getComputedStyle(document.documentElement).backgroundColor,
        heading: heading.color,
        body: getComputedStyle(document.querySelector(".lead")!).color,
      };
    });
    const [r, g, b] = colours.heading.match(/\d+/g)!.map(Number);
    const bg = [colours.page, colours.root].find((c) => !/rgba\(.*, 0\)$/.test(c) && c !== "transparent") ?? colours.root;
    assert.notEqual(colours.heading, bg, "heading colour differs from the background");
    assert.notEqual(colours.body, bg, "body text colour differs from the background");
    const luminance = (rgb: number[]) => 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!;
    const bgLum = luminance(bg.match(/\d+/g)!.map(Number));
    const inkLum = luminance([r!, g!, b!]);
    assert.ok(Math.abs(bgLum - inkLum) > 100, `enough contrast between ${colours.heading} and ${bg}`);
    if (scheme === "dark") assert.ok(bgLum < inkLum, "light text on a dark page");
    else assert.ok(bgLum > inkLum, "dark text on a light page");
    await ctx.close();
  });
}
