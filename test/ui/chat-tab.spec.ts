import assert from "node:assert/strict";
import test from "node:test";
import type { BrowserContext, Page } from "playwright-core";
import { openAlerts, useLoaner } from "./harness.js";
import { skipWhatsNew } from "./whats-new-seen.js";

const loaner = useLoaner();

async function call(method: string, url: string, token: string | null, body?: unknown): Promise<any> {
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${loaner.baseUrl}${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.ok(res.ok, `${method} ${url} -> ${res.status}`);
  return res.json();
}

const person = async (name: string) =>
  (await call("POST", "/api/auth/start", null, { name, email: `${name.toLowerCase()}@example.com` })).token as string;

/** A signed-in phone at /app#/route. */
async function open(token: string, route: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await loaner.phone();
  await ctx.addInitScript((t) => localStorage.setItem("loaner_token", t), token);
  await skipWhatsNew(ctx);
  const page = await ctx.newPage();
  await page.goto(`${loaner.baseUrl}/app${route}`);
  await page.locator("nav.ak-tabbar").waitFor();
  return { ctx, page };
}

// Not exact: with unread messages the button's name also carries the badge label.
const tab = (page: Page, name: string) => page.locator(".ak-tabbar").getByRole("button", { name, exact: false });
const h1 = (page: Page, name: string) => page.getByRole("heading", { level: 1, name });

test("the tab bar has Chat and no Alerts, and the bell sits on every main tab", { timeout: 90_000 }, async () => {
  const ana = await person("Anachat");
  await call("POST", "/api/groups", ana, { name: "Flat 3B" });
  const { ctx, page } = await open(ana, "#/browse");

  const labels = await page.locator(".ak-tabbar button").allInnerTexts();
  assert.deepEqual(labels.map((text) => text.replace(/\d+/g, "").trim()), ["Browse", "My items", "Requests", "Chat", "You"]);
  assert.equal(await tab(page, "Alerts").count(), 0, "no Alerts tab");

  for (const name of ["Browse", "My items", "Requests", "Chat", "You"]) {
    await tab(page, name).click();
    await h1(page, name).waitFor();
    assert.equal(await page.locator("[data-alerts-bell]").count(), 1, `the bell is on ${name}`);
  }
  const fit = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  assert.equal(fit.scroll, fit.client, "no horizontal scroll with the bell in the header");
  await ctx.close();
});

test("Chat lists my groups with the last message and unread, newest first, and a row opens that chat", { timeout: 90_000 }, async () => {
  const ana = await person("Analist");
  const ben = await person("Benlist");
  const flat = (await call("POST", "/api/groups", ana, { name: "Flat 3B" })).group;
  const club = (await call("POST", "/api/groups", ana, { name: "Climbing club" })).group;
  await call("POST", `/api/invites/${flat.inviteCode}/join`, ben);
  await call("POST", `/api/invites/${club.inviteCode}/join`, ben);
  await call("POST", `/api/groups/${flat.id}/chat`, ana, { text: "Anyone need the drill?" });
  await call("POST", `/api/groups/${club.id}/chat`, ana, { text: "Ropes are in the shed" });
  await call("POST", `/api/groups/${club.id}/chat`, ana, { text: "Second one" });

  const { ctx, page } = await open(ben, "#/browse");
  await tab(page, "Chat").click();
  await h1(page, "Chat").waitFor();
  const rows = page.locator("button.chat-row");
  await rows.first().waitFor();
  assert.equal(await rows.count(), 2);
  assert.match(await rows.nth(0).innerText(), /Climbing club/);
  assert.match(await rows.nth(0).innerText(), /Second one/, "newest message first");
  assert.match(await rows.nth(1).innerText(), /Anyone need the drill\?/);
  assert.equal((await rows.nth(0).locator("[data-chat-unread]").textContent())?.trim(), "2");
  assert.equal((await rows.nth(1).locator("[data-chat-unread]").textContent())?.trim(), "1");
  assert.equal((await page.locator(".ak-tabbar .ak-badge").textContent())?.trim(), "3", "the tab badge is the total");

  await rows.nth(1).click();
  await page.locator(".ak-chat-composer").waitFor();
  assert.match(page.url(), new RegExp(`#/group/${flat.id}/chat$`));
  assert.equal(await tab(page, "Chat").getAttribute("aria-current"), "page", "Chat stays highlighted");

  // Back returns to the list, with that row read and the other still unread.
  await page.goBack();
  await rows.first().waitFor();
  assert.equal(await page.locator("[data-chat-unread]").count(), 1);
  assert.equal((await page.locator(".ak-tabbar .ak-badge").textContent())?.trim(), "2");
  await ctx.close();
});

test("a one-group member still sees the list, and a member of none sees the empty state", { timeout: 90_000 }, async () => {
  const solo = await person("Solochat");
  const none = await person("Nonechat");
  await call("POST", "/api/groups", solo, { name: "Just me" });

  const one = await open(solo, "#/chat");
  await h1(one.page, "Chat").waitFor();
  await one.page.locator("button.chat-row").waitFor();
  assert.match(await one.page.locator("button.chat-row").innerText(), /No messages yet/);
  await one.ctx.close();

  const empty = await open(none, "#/chat");
  await empty.page.getByText("No group chats yet").waitFor();
  assert.equal(await empty.page.locator("button.chat-row").count(), 0);
  await empty.ctx.close();
});

test("the bell opens Alerts and Back returns to the tab it came from", { timeout: 90_000 }, async () => {
  const ana = await person("Anabell");
  await call("POST", "/api/groups", ana, { name: "Flat 3B" });
  const { ctx, page } = await open(ana, "#/browse");

  for (const name of ["Requests", "Chat", "You"]) {
    await tab(page, name).click();
    await h1(page, name).waitFor();
    await openAlerts(page);
    assert.equal(await page.locator(".ak-tabbar [aria-current]").count(), 0, "no tab is highlighted on Alerts");
    await page.locator("#alerts-back").click();
    await h1(page, name).waitFor();
  }

  // A direct load of Alerts has nothing to go back to, so Back lands on Browse.
  await page.goto(`${loaner.baseUrl}/app#/alerts`);
  await h1(page, "Alerts").waitFor();
  await page.locator("#alerts-back").click();
  await h1(page, "Browse").waitFor();
  await ctx.close();
});

test("the You card has no Group chat button", { timeout: 60_000 }, async () => {
  const ana = await person("Anayou");
  await call("POST", "/api/groups", ana, { name: "Flat 3B" });
  const { ctx, page } = await open(ana, "#/you");
  await h1(page, "You").waitFor();
  await page.locator("section.card[data-group]").waitFor();
  assert.equal(await page.getByRole("button", { name: "Group chat" }).count(), 0);
  assert.equal(await page.locator("[data-chat-open]").count(), 0);
  await ctx.close();
});
