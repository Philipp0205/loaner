import assert from "node:assert/strict";
import test from "node:test";
import type { BrowserContext, Page } from "playwright-core";
import { openWelcome, signUp as signUpVia, useLoaner } from "./harness.js";
import { ENTRIES, formatEntryDate } from "./whats-new-seen.js";

const loaner = useLoaner();

// Expected values come from public/app-kit/ak-tokens.css and the overrides in public/css/tokens.css.
const DARK_BG = "rgb(0, 0, 0)";
const DARK_CARD = "rgb(28, 28, 30)";
const DARK_INK = "rgb(255, 255, 255)";
const LIGHT_BG = "rgb(255, 255, 255)";
const LIGHT_INK = "rgb(0, 0, 0)";
const CAMERA_BG = "rgb(11, 15, 15)";

// These run in the page. They are strings so the test runner's transform cannot add helper calls to them.
/** Elements (outside the camera) whose own background is exactly white. In dark the kit's button fill is white, so the elements that use it are skipped. */
const WHITE_CHROME = `(() => [...document.querySelectorAll("body *")]
  .filter((el) => !el.closest(".camera") && !el.matches("button.primary, .pill.lent, .bubble, .lent-badge, .avatar, .chip, .ak-ip-install") && getComputedStyle(el).backgroundColor === "rgb(255, 255, 255)")
  .map((el) => el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.split(" ").join(".") : "")))()`;

/** Visible text and form controls whose colour against the surface behind them is under AA. */
const LOW_CONTRAST = `(() => {
  const parse = (s) => { const m = s.match(/[\\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const behind = (el) => {
    for (let n = el; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c.a > 0.95) return c; }
    return parse("rgb(255, 255, 255)");
  };
  const bad = [];
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest(".camera, .ak-scrim, .sr-only, svg") || el.disabled || el.getClientRects().length === 0) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own && !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) continue;
    const s = getComputedStyle(el);
    if (Number(s.opacity) < 1 || s.visibility === "hidden") continue;
    const fg = parse(s.color), bg = behind(el);
    const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
    const ratio = (hi + 0.05) / (lo + 0.05);
    const large = parseFloat(s.fontSize) >= 24 || (parseFloat(s.fontSize) >= 18.66 && Number(s.fontWeight) >= 700);
    if (ratio < (large ? 3 : 4.5)) bad.push(el.tagName.toLowerCase() + "." + el.className + " " + JSON.stringify((el.textContent || el.value || "").trim().slice(0, 30)) + " " + ratio.toFixed(2));
  }
  return bad;
})()`;

/** RGBA of the L stem and of the arrow head in the rendered wordmark image, drawn to a canvas at 2x. */
const WORDMARK_PIXELS = `(async () => {
  const img = document.querySelector("img.wordmark");
  if (!img.complete) await new Promise((done) => img.addEventListener("load", done, { once: true }));
  const canvas = document.createElement("canvas");
  canvas.width = 974; canvas.height = 164;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, 974, 164);
  return { stem: [...ctx.getImageData(15, 80, 1, 1).data], arrow: [...ctx.getImageData(165, 92, 1, 1).data] };
})()`;

type Pixels = { stem: number[]; arrow: number[] };
const computed = (page: Page, selector: string, prop: string) => page.evaluate(([sel, p]) => getComputedStyle(document.querySelector(sel)!).getPropertyValue(p), [selector, prop] as const);
const luminanceOf = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

async function signUp(page: Page, name: string) {
  await signUpVia(page, loaner.baseUrl, name);
  await page.getByRole("heading", { name: "No groups yet" }).waitFor();
}

async function settle(page: Page) {
  await page.waitForFunction(() => !document.querySelector(".spinner"));
  await page.evaluate(() => document.fonts.ready);
}

/** The page is dark with light text, no white chrome, and readable text everywhere. */
async function assertDark(page: Page, label: string) {
  await settle(page);
  assert.equal(await computed(page, "body", "background-color"), DARK_BG, `${label}: body background`);
  assert.equal(await computed(page, "body", "color"), DARK_INK, `${label}: body text`);
  assert.deepEqual(await page.evaluate<string[]>(WHITE_CHROME), [], `${label}: white chrome`);
  assert.deepEqual(await page.evaluate<string[]>(LOW_CONTRAST), [], `${label}: low contrast text`);
}

const tab = (page: Page, name: string) => page.locator(".ak-tabbar").getByRole("button", { name }).click();

async function darkPhone(): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  const ctx = await loaner.phone({ colorScheme: "dark" });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  return { ctx, page, errors };
}

test("light mode: white page, black buttons, dark lettering", { timeout: 60_000 }, async () => {
  const ctx = await loaner.phone({ colorScheme: "light" });
  const page = await ctx.newPage();
  await openWelcome(page, loaner.baseUrl);
  assert.equal(await computed(page, "body", "background-color"), LIGHT_BG);
  assert.equal(await computed(page, "body", "color"), LIGHT_INK);
  assert.equal(await computed(page, "button.primary", "background-color"), LIGHT_INK);
  assert.equal(await computed(page, "button.primary", "color"), LIGHT_BG);
  assert.equal(await page.evaluate(() => matchMedia("(prefers-color-scheme: light)").matches), true);
  const pixels = await page.evaluate<Pixels>(WORDMARK_PIXELS);
  assert.ok(luminanceOf(pixels.stem) < 90, `the lettering is dark in light mode: ${pixels.stem}`);
  await ctx.close();
});

test("the wordmark letters go light in dark mode and the teal arrow does not change", { timeout: 60_000 }, async () => {
  const sample = async (colorScheme: "light" | "dark") => {
    const ctx = await loaner.phone({ colorScheme });
    const page = await ctx.newPage();
    await page.goto(`${loaner.baseUrl}/app`);
    await page.locator("img.wordmark").waitFor();
    const pixels = await page.evaluate<Pixels>(WORDMARK_PIXELS);
    await ctx.close();
    return pixels;
  };
  const light = await sample("light");
  const dark = await sample("dark");
  assert.equal(dark.stem[3], 255, "the stem pixel is opaque");
  assert.ok(luminanceOf(light.stem) < 90, `light lettering is dark ink: ${light.stem}`);
  assert.ok(luminanceOf(dark.stem) > 180, `dark lettering is light: ${dark.stem}`);
  assert.ok(Math.abs(dark.stem[0] - 232) < 8 && Math.abs(dark.stem[1] - 240) < 8, `dark lettering is the off-white ink: ${dark.stem}`);
  for (const arrow of [light.arrow, dark.arrow]) {
    assert.equal(arrow[3], 255);
    assert.ok(arrow[1] > 110 && arrow[0] < 80 && arrow[2] > 100, `the arrow is teal: ${arrow}`);
  }
  assert.deepEqual(dark.arrow, light.arrow, "the arrow is identical in both schemes");
});

test("dark mode: the main screens stay dark with readable text and no white chrome", { timeout: 120_000 }, async () => {
  const { ctx, page, errors } = await darkPhone();

  // Signed out: welcome and the recovery screen.
  await openWelcome(page, loaner.baseUrl);
  await assertDark(page, "welcome");
  assert.equal(await computed(page, "button.primary", "background-color"), DARK_INK, "the primary button is the kit's white fill");
  assert.equal(await computed(page, "button.primary", "color"), DARK_BG, "the primary button text is black");
  await page.getByRole("button", { name: "I have a recovery code" }).click();
  await page.locator("#recover-code").waitFor();
  await assertDark(page, "recover");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.locator("#name").waitFor();

  // Signed up, no group yet.
  await signUp(page, "Dara");
  await assertDark(page, "no groups");
  await page.locator("#group-name").fill("Flat 3B");
  await page.getByRole("button", { name: "Create group" }).click();
  await page.locator("#group-switch").waitFor();
  await assertDark(page, "browse, empty");

  // A listed item: the tile, then the item page with its sticky bar and back button.
  const groupId = await page.locator("#group-switch").inputValue();
  const token = await page.evaluate(() => localStorage.getItem("loaner_token"));
  const made = await fetch(`${loaner.baseUrl}/api/items`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ name: "Cordless drill", note: "Battery lasts about 30 min.", donation: 5, groupIds: [groupId] }),
  });
  assert.equal(made.status, 201);
  const { item } = (await made.json()) as { item: { id: string } };
  await tab(page, "My items");
  await page.getByRole("heading", { level: 1, name: "My items" }).waitFor();
  await assertDark(page, "my items");
  await tab(page, "Browse");
  await page.locator("button.tile", { hasText: "Cordless drill" }).waitFor();
  await assertDark(page, "browse, one item");
  await page.locator("button.tile", { hasText: "Cordless drill" }).click();
  await page.locator(".bar").waitFor();
  await assertDark(page, "item page");
  assert.equal(await computed(page, ".bar", "background-color"), DARK_CARD, "the sticky bar is a dark card");
  assert.equal(await computed(page, ".fab", "background-color"), DARK_CARD, "the back button is a dark card");
  await page.evaluate((id) => { location.hash = `#/mine/edit/${id}`; }, item.id);
  await page.locator("form.item-form").waitFor();
  await assertDark(page, "edit item form");

  // Add an item: the camera is a dark viewfinder in dark mode too.
  await page.evaluate(() => (location.hash = "#/mine/new"));
  await page.locator("#camera-add").waitFor();
  assert.equal(await computed(page, "#camera-add", "background-color"), CAMERA_BG, "the camera background");
  assert.equal(await computed(page, "#camera-add", "color"), "rgb(255, 255, 255)", "the camera text is white");
  assert.equal(await computed(page, ".cam-btn", "color"), "rgb(255, 255, 255)");
  const cover = await page.locator("#camera-add").boundingBox();
  assert.deepEqual([cover?.width, cover?.height], [390, 844], "the camera covers the screen");
  await page.locator("#camera-close").click();
  await page.getByRole("heading", { level: 1, name: "My items" }).waitFor();

  await page.evaluate(() => (location.hash = "#/mine/new/form"));
  await page.locator("form.item-form").waitFor();
  await assertDark(page, "new item form");

  // Requests, Chat, Alerts (from the bell), You.
  await tab(page, "Requests");
  await page.getByRole("heading", { level: 1, name: "Requests" }).waitFor();
  await assertDark(page, "requests");
  await tab(page, "Chat");
  await page.getByRole("heading", { level: 1, name: "Chat" }).waitFor();
  await page.locator(".chat-row").waitFor();
  await assertDark(page, "chat list");
  await page.locator("[data-alerts-bell]").click();
  await page.getByRole("heading", { level: 1, name: "Alerts" }).waitFor();
  await assertDark(page, "alerts");
  await tab(page, "You");
  await page.getByRole("heading", { level: 1, name: "You" }).waitFor();
  await page.locator("section.card[data-group]").waitFor();
  await assertDark(page, "you, with a group card");

  // The invite screen a friend sees, signed out in their own dark phone.
  const inviteCode = /\/join\/([A-Za-z0-9]+)/.exec(await page.locator(".invite-link").innerText())?.[1];
  assert.ok(inviteCode, "the group card shows an invite link");
  const friend = await loaner.phone({ colorScheme: "dark" });
  const joinPage = await friend.newPage();
  await joinPage.goto(`${loaner.baseUrl}/join/${inviteCode}`);
  await joinPage.getByRole("heading", { name: "Join Flat 3B?" }).waitFor();
  await assertDark(joinPage, "join");
  await friend.close();

  assert.deepEqual(errors, []);
  await ctx.close();
});

test("dark mode: the What's new and feedback sheets use the dark card, not white", { timeout: 90_000 }, async () => {
  const { ctx, page, errors } = await darkPhone();
  await signUp(page, "Esme");
  await tab(page, "You");
  await page.getByRole("heading", { level: 1, name: "You" }).waitFor();

  await page.locator("#open-whats-new").click();
  const whatsNew = page.getByRole("dialog", { name: "What's new" });
  await whatsNew.waitFor();
  await page.waitForTimeout(500);
  assert.equal(await computed(page, ".ak-sheet", "background-color"), DARK_CARD, "What's new sheet surface");
  assert.equal(await computed(page, ".ak-sheet", "color"), DARK_INK, "What's new sheet text");
  assert.equal(await computed(page, ".ak-scrim", "background-color"), "rgba(0, 0, 0, 0.72)", "the scrim is the kit's dark scrim");
  assert.equal(await computed(page, ".wn-entry h3", "color"), DARK_INK);
  assert.equal(await whatsNew.locator(".wn-date").first().textContent(), formatEntryDate(ENTRIES[0].date));
  assert.equal(await whatsNew.getByRole("heading", { name: "Dark mode", exact: true }).count(), 1, "the dark mode entry is listed");
  await assertDark(page, "what's new sheet");
  await whatsNew.getByRole("button", { name: "Done" }).click();
  await whatsNew.waitFor({ state: "detached" });

  const row = page.locator("#open-feedback");
  await row.scrollIntoViewIfNeeded();
  await row.click();
  const feedback = page.getByRole("dialog", { name: "Send feedback" });
  await feedback.waitFor();
  await page.waitForTimeout(500);
  assert.equal(await computed(page, ".ak-sheet", "background-color"), DARK_CARD, "feedback sheet surface");
  assert.equal(await computed(page, ".ak-sheet textarea", "background-color"), DARK_CARD, "feedback text box");
  assert.equal(await computed(page, ".ak-sheet textarea", "color"), DARK_INK, "feedback text colour");
  await feedback.getByRole("button", { name: "Send" }).click();
  await feedback.getByRole("alert").getByText("Write something first.").waitFor();
  await assertDark(page, "feedback sheet with an error");
  await page.keyboard.press("Escape");
  await feedback.waitFor({ state: "detached" });

  assert.deepEqual(errors, []);
  await ctx.close();
});

test("light mode: the sheets are still white", { timeout: 60_000 }, async () => {
  const ctx = await loaner.phone({ colorScheme: "light" });
  const page = await ctx.newPage();
  await signUp(page, "Finn");
  await tab(page, "You");
  await page.getByRole("heading", { level: 1, name: "You" }).waitFor();
  await page.locator("#open-whats-new").click();
  await page.getByRole("dialog", { name: "What's new" }).waitFor();
  assert.equal(await computed(page, ".ak-sheet", "background-color"), LIGHT_BG);
  assert.equal(await computed(page, ".ak-scrim", "background-color"), "rgba(0, 0, 0, 0.45)");
  await ctx.close();
});
