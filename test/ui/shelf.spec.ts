import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type { Page } from "playwright-core";
import { useLoaner } from "./harness.js";
import { solidPng } from "./png.js";
import { skipWhatsNew } from "./whats-new-seen.js";

const SHOTS = path.resolve("test/ui/screenshots/shelf");
const loaner = useLoaner();
const SIZES = [{ width: 390, height: 844 }, { width: 360, height: 780 }];

async function call(method: string, url: string, token: string | null, body?: unknown, raw?: Buffer): Promise<any> {
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  if (raw) headers["content-type"] = "image/png";
  else if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${loaner.baseUrl}${url}`, { method, headers, body: raw ? new Uint8Array(raw) : body === undefined ? undefined : JSON.stringify(body) });
  assert.ok(res.ok, `${method} ${url} -> ${res.status}`);
  return res.json();
}

/** Lena lists a drill (EUR 5, photo) and a tent that is lent to Sophie. Max is the borrower. */
async function seed() {
  const lena = await call("POST", "/api/auth/start", null, { name: "Lena" });
  const sophie = await call("POST", "/api/auth/start", null, { name: "Sophie" });
  const max = await call("POST", "/api/auth/start", null, { name: "Max" });
  const { group } = await call("POST", "/api/groups", lena.token, { name: "WG Lissabon" });
  for (const p of [sophie, max]) await call("POST", `/api/invites/${group.inviteCode}/join`, p.token);
  const drill = (await call("POST", "/api/items", lena.token, { name: "Cordless drill", note: "Akku haelt ca. 30 Min.", donation: 5, groupIds: [group.id] })).item;
  const tent = (await call("POST", "/api/items", lena.token, { name: "2-person tent", note: "", donation: null, groupIds: [group.id] })).item;
  await call("POST", "/api/items", lena.token, { name: "Aluminium ladder", note: "", donation: null, groupIds: [group.id] });
  await call("PUT", `/api/items/${drill.id}/photo`, lena.token, undefined, solidPng(800, 600, [190, 60, 50]));
  await call("PUT", `/api/items/${tent.id}/photo`, lena.token, undefined, solidPng(800, 600, [200, 150, 70]));
  const { today } = await call("GET", "/api/me", sophie.token);
  const until = new Date(Date.parse(`${today}T00:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10);
  const { request } = await call("POST", `/api/items/${tent.id}/requests`, sophie.token, { from: today, until, message: "Camping" });
  await call("POST", `/api/requests/${request.id}/approve`, lena.token, {});
  await call("POST", `/api/requests/${request.id}/handover`, lena.token);
  return { lena, max, drill, tent };
}

async function open(token: string, size: { width: number; height: number }, hash = ""): Promise<{ page: Page; hosts: Set<string> }> {
  const ctx = await loaner.phone();
  await ctx.addInitScript((t) => localStorage.setItem("loaner_token", t), token);
  await skipWhatsNew(ctx);
  const page = await ctx.newPage();
  const hosts = new Set<string>();
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.protocol === "http:" || url.protocol === "https:") hosts.add(url.host);
  });
  await page.setViewportSize(size);
  await page.goto(`${loaner.baseUrl}/${hash}`);
  return { page, hosts };
}

const shot = async (page: Page, name: string) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name) });
};

for (const size of SIZES) {
  test(`shelf browse at ${size.width}px: Inter loaded, nothing leaves the origin, 4:5 photos, lent badge, 44px targets`, { timeout: 60_000 }, async () => {
    const { max } = await seed();
    const { page, hosts } = await open(max.token, size);
    await page.locator("button.tile", { hasText: "2-person tent" }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll(".tile img.photo").length === 2 && [...document.querySelectorAll<HTMLImageElement>(".tile img.photo")].every((i) => i.naturalWidth > 0));
    await shot(page, `browse-${size.width}.png`);

    const font = await page.evaluate(async () => {
      await document.fonts.load("600 16px Inter");
      return { family: getComputedStyle(document.body).fontFamily, loaded: [...document.fonts].some((f) => f.family.replace(/"/g, "") === "Inter" && f.status === "loaded"), check: document.fonts.check("600 16px Inter") };
    });
    assert.match(font.family, /^"?Inter"?,/);
    assert.ok(font.loaded && font.check, "Inter is loaded from the self-hosted file");
    assert.deepEqual([...hosts], [new URL(loaner.baseUrl).host], "no request leaves the origin");

    for (const r of await page.locator(".tile img.photo").evaluateAll((els) => els.map((el) => el.getBoundingClientRect()))) {
      assert.ok(Math.abs(r.width / r.height - 4 / 5) < 0.02, `tile photo is 4:5 (${r.width}x${r.height})`);
    }
    assert.equal(await page.locator(".tile .lent-badge").innerText(), "Lent");
    assert.match(await page.locator(".tile", { hasText: "2-person tent" }).innerText(), /With Sophie \u00b7 back \d{1,2} \w{3}/);
    const free = await page.locator(".tile .free").innerText();
    assert.equal(free, "Free to borrow");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
    const tabs = await page.locator(".tabbar button").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
    assert.equal(tabs.length, 5);
    assert.ok(tabs.every((h) => h >= 44), "tab bar targets are at least 44px");
    assert.ok(await page.locator(".tabbar svg").count() === 5, "tab icons are inline svg");
  });

  test(`shelf detail at ${size.width}px: sticky bar sits above the tab bar, clear of the dates, and sends the request`, { timeout: 60_000 }, async () => {
    const { max, drill } = await seed();
    const { page } = await open(max.token, size, `#/item/${drill.id}`);
    await page.locator(".bar").waitFor();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await shot(page, `detail-${size.width}.png`);

    const box = await page.evaluate(() => {
      const bar = document.querySelector(".bar")!;
      const sel = [".bar", ".tabbar", ".dates", "#req-message", ".bar button"];
      const [b, tabs, dates, msg, cta] = sel.map((s) => document.querySelector(s)!.getBoundingClientRect());
      return { pos: getComputedStyle(bar).position, bar: b, tabs, dates, msg, cta, text: bar.textContent };
    });
    assert.equal(box.pos, "fixed");
    assert.ok(box.bar.bottom <= box.tabs.top + 0.5, "bar is above the tab bar");
    assert.ok(box.dates.bottom <= box.bar.top && box.msg.bottom <= box.bar.top, "From/Until and message are not covered by the bar");
    assert.ok(box.cta.height >= 44, "Request button is at least 44px tall");
    assert.match(box.text ?? "", /€5.*suggested donation.*Request/);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector(".bar button")!).backgroundColor), "rgb(34, 34, 34)");

    await page.locator("#req-message").fill("Shelves");
    await page.locator(".bar").getByRole("button", { name: "Send request" }).click();
    await page.getByText("Your requests").waitFor();
    await page.locator("article.card", { hasText: "Shelves" }).locator(".pill", { hasText: "Waiting" }).waitFor();
  });
}

test("theme-color meta equals the manifest theme_color", { timeout: 30_000 }, async () => {
  const html = await (await fetch(`${loaner.baseUrl}/`)).text();
  const meta = /<meta name="theme-color" content="([^"]+)"/.exec(html)?.[1];
  const manifest = await (await fetch(`${loaner.baseUrl}/manifest.webmanifest`)).json();
  assert.equal(meta?.toLowerCase(), String(manifest.theme_color).toLowerCase());
  assert.equal(String(manifest.background_color).toLowerCase(), "#ffffff");
});
