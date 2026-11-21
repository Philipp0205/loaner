import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "playwright-core";
import { bellBadge, openAlerts, openWelcome, useLoaner } from "./harness.js";

const loaner = useLoaner();

// Expected values come from the kit's dark tokens (public/app-kit/ak-tokens.css).
const DARK_BG = "rgb(0, 0, 0)";
const DARK_CARD = "rgb(28, 28, 30)";
const DARK_INK = "rgb(255, 255, 255)";
const DARK_SOFT = "rgb(20, 20, 22)";
const DARK_INK_INVERSE = "rgb(0, 0, 0)";

const tab = (page: Page, name: string) => page.locator(".ak-tabbar").getByRole("button", { name, exact: false }).click();
const computed = (page: Page, selector: string, prop: string) =>
  page.evaluate(([sel, p]) => getComputedStyle(document.querySelector(sel)!).getPropertyValue(p), [selector, prop] as const);
const messageCount = () => (loaner.db.prepare("SELECT COUNT(*) AS n FROM messages").get() as { n: number }).n;

test("Bo messages Tess about her drill, Tess replies from her request card", { timeout: 150_000 }, async () => {
  const errors: string[] = [];
  const watch = (page: Page, who: string) => {
    page.on("pageerror", (error) => errors.push(`${who}: ${error}`));
    page.on("console", (msg) => { if (msg.type() === "error") errors.push(`${who} console: ${msg.text()}`); });
  };
  const tessCtx = await loaner.phone();
  const boCtx = await loaner.phone();
  const tess = await tessCtx.newPage();
  const bo = await boCtx.newPage();
  watch(tess, "tess");
  watch(bo, "bo");

  // Tess signs up, creates a group and shares a drill.
  await openWelcome(tess, loaner.baseUrl);
  await tess.locator("#name").fill("Tess");
  await tess.locator("#email").fill("tess@example.com");
  await tess.getByRole("button", { name: "Get started" }).click();
  await tess.getByRole("heading", { name: "No groups yet" }).waitFor();
  await tess.locator("#group-name").fill("Flat 3B");
  await tess.getByRole("button", { name: "Create group" }).click();
  await tess.locator("#group-switch").waitFor();
  const groupId = await tess.locator("#group-switch").inputValue();
  const tessToken = await tess.evaluate(() => localStorage.getItem("loaner_token"));
  const made = await fetch(`${loaner.baseUrl}/api/items`, {
    method: "POST",
    headers: { authorization: `Bearer ${tessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ name: "Cordless drill", note: "Battery lasts about 30 min", groupIds: [groupId] }),
  });
  assert.equal(made.status, 201);
  const itemId = ((await made.json()) as { item: { id: string } }).item.id;

  // Bo joins through the invite link.
  await tab(tess, "You");
  const invite = await tess.locator(".invite-link").innerText();
  await bo.goto(invite.trim());
  await bo.getByRole("heading", { name: "Join Flat 3B?" }).waitFor();
  await bo.locator("#name").fill("Bo");
  await bo.locator("#email").fill("bo@example.com");
  await bo.getByRole("button", { name: "Join Flat 3B" }).click();
  await bo.locator("nav.ak-tabbar").waitFor();

  // Bo opens the drill and taps Message. An empty send is rejected and posts nothing.
  await bo.locator("button.tile", { hasText: "Cordless drill" }).click();
  await bo.getByRole("heading", { level: 1, name: "Cordless drill" }).waitFor();
  assert.equal(await bo.locator("button.msg-btn [data-unread]").count(), 0, "no unread dot yet");
  await bo.getByRole("button", { name: "Message" }).click();
  await bo.locator("#msg-form").waitFor();
  await bo.getByText("With Tess").waitFor();
  await bo.getByText("No messages yet. Say hello to Tess.").waitFor();
  await bo.getByRole("button", { name: "Send", exact: true }).click();
  await bo.getByRole("alert").filter({ hasText: "Write a message first." }).waitFor();
  await bo.locator("#msg-body").fill("   \n  ");
  await bo.getByRole("button", { name: "Send", exact: true }).click();
  await bo.getByRole("alert").filter({ hasText: "Write a message first." }).waitFor();
  assert.equal(messageCount(), 0, "nothing was posted");

  // A real message, with a line break and some HTML that must stay text.
  await bo.locator("#msg-body").fill("Can I borrow it Saturday?\n<b>thanks</b>");
  await bo.getByRole("button", { name: "Send", exact: true }).click();
  const mine = bo.locator(".msg.mine .bubble");
  await mine.waitFor();
  assert.equal(await mine.textContent(), "Can I borrow it Saturday?\n<b>thanks</b>");
  assert.equal(await bo.locator(".bubble b").count(), 0, "the HTML was not turned into elements");
  assert.equal(await bo.locator("#msg-body").inputValue(), "", "the composer is cleared");
  assert.equal(messageCount(), 1);

  // Bo also asks for it, so Tess has a request card for the same thread.
  const boToken = await bo.evaluate(() => localStorage.getItem("loaner_token"));
  const today = new Date().toISOString().slice(0, 10);
  const asked = await fetch(`${loaner.baseUrl}/api/items/${itemId}/requests`, {
    method: "POST",
    headers: { authorization: `Bearer ${boToken}`, "content-type": "application/json" },
    body: JSON.stringify({ from: today, until: today, message: "Hanging shelves" }),
  });
  assert.equal(asked.status, 201);

  // Tess sees the alert badge and the unread dot on the request card. Neither shows the text.
  await tess.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await bellBadge(tess).waitFor();
  assert.equal(await bellBadge(tess).textContent(), "2", "the new message and the new request");
  await openAlerts(tess);
  const note = tess.locator("article.card.unread", { hasText: "New message" });
  await note.getByText("Bo sent you a message about Cordless drill.").waitFor();
  assert.equal(await note.getByText("Saturday").count(), 0, "the alert does not carry the message");
  await tab(tess, "Requests");
  const card = tess.locator("article.card", { hasText: "Bo wants Cordless drill" });
  await card.locator("button.msg-btn [data-unread]").waitFor();

  // Tess opens the thread from the request card and replies.
  await card.getByRole("button", { name: "Message" }).click();
  await tess.locator("#msg-form").waitFor();
  await tess.getByText("With Bo").waitFor();
  await tess.locator(".msg.theirs .bubble", { hasText: "Can I borrow it Saturday?" }).waitFor();
  assert.equal(await tess.locator(".msg.mine").count(), 0);
  await tess.locator("#msg-body").fill("Sure, come at 10.");
  await tess.getByRole("button", { name: "Send", exact: true }).click();
  await tess.locator(".msg.mine .bubble", { hasText: "Sure, come at 10." }).waitFor();

  // Opening the thread cleared the dot and its alert. Only the unread "New request" alert is left.
  await tab(tess, "Requests");
  await tess.locator("article.card", { hasText: "Bo wants Cordless drill" }).getByRole("button", { name: "Message" }).waitFor();
  assert.equal(await tess.locator("button.msg-btn [data-unread]").count(), 0, "unread cleared after opening");
  await tess.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await tess.waitForFunction(() => document.querySelector("[data-alerts-bell] .ak-badge")?.textContent === "1");

  // Bo, still in the thread, sees the reply without reloading (the thread polls).
  await bo.locator(".msg.theirs .bubble", { hasText: "Sure, come at 10." }).waitFor({ timeout: 15_000 });

  // Bo leaves, Tess replies again, and the dot shows on both of Bo's Message buttons after a reload.
  await bo.goto(`${loaner.baseUrl}/#/item/${itemId}`);
  await bo.getByRole("heading", { level: 1, name: "Cordless drill" }).waitFor();
  assert.equal(await bo.locator("button.msg-btn [data-unread]").count(), 0, "Bo has read everything");
  await tess.locator("article.card", { hasText: "Bo wants Cordless drill" }).getByRole("button", { name: "Message" }).click();
  await tess.locator("#msg-body").fill("Bring a bit of tape.");
  await tess.getByRole("button", { name: "Send", exact: true }).click();
  await tess.locator(".msg.mine .bubble", { hasText: "Bring a bit of tape." }).waitFor();
  await bo.reload();
  await bo.locator(".host button.msg-btn [data-unread]").waitFor();
  await bo.locator("article.card button.msg-btn [data-unread]").waitFor();
  // The alert opens the borrower's thread too. The bell sits on a tab root, so go to Browse first.
  await tab(bo, "Browse");
  await openAlerts(bo);
  const alert = bo.locator("article.card.unread", { hasText: "Tess sent you a message about Cordless drill." }).first();
  assert.equal(await alert.getByText("tape").count(), 0, "the alert does not carry the message");
  await alert.getByRole("button", { name: "Open" }).click();
  await bo.locator("#msg-form").waitFor();
  await bo.locator(".msg.theirs .bubble", { hasText: "Bring a bit of tape." }).waitFor();
  await bo.goto(`${loaner.baseUrl}/#/item/${itemId}`);
  await bo.reload();
  await bo.getByRole("heading", { level: 1, name: "Cordless drill" }).waitFor();
  await bo.locator(".host button.msg-btn").waitFor();
  assert.equal(await bo.locator("button.msg-btn [data-unread]").count(), 0, "the dots are gone once the thread was opened");

  // Bo's Your requests card opens the same thread: Bo's message and Tess's two replies.
  await bo.locator("article.card", { hasText: "Cordless drill from Tess" }).getByRole("button", { name: "Message" }).click();
  await bo.locator(".msg .bubble").first().waitFor();
  assert.equal(await bo.locator(".msg .bubble").count(), 3);
  assert.equal(await bo.locator(".msg.mine .bubble").count(), 1);
  assert.equal(await bo.locator(".msg.theirs .bubble").count(), 2);

  // Layout: no sideways scroll on either phone.
  for (const page of [tess, bo]) {
    const fit = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    assert.equal(fit.scroll, fit.client, "no horizontal scroll");
  }

  // Dark mode: Bo opens the same thread on a dark phone.
  const dark = await loaner.phone({ colorScheme: "dark" });
  const darkPage = await dark.newPage();
  watch(darkPage, "bo dark");
  await darkPage.addInitScript((token) => localStorage.setItem("loaner_token", token as string), boToken);
  await darkPage.goto(`${loaner.baseUrl}/#/item/${itemId}/messages`);
  await darkPage.locator(".msg.mine .bubble").first().waitFor();
  await darkPage.locator(".msg.theirs .bubble").first().waitFor();
  assert.equal(await computed(darkPage, "body", "background-color"), DARK_BG);
  assert.equal(await computed(darkPage, ".thread-composer", "background-color"), DARK_BG);
  assert.equal(await computed(darkPage, "#msg-body", "background-color"), DARK_CARD);
  assert.equal(await computed(darkPage, "#msg-body", "color"), DARK_INK);
  assert.equal(await computed(darkPage, ".msg.mine .bubble", "background-color"), DARK_INK, "my bubble is the kit's button fill");
  assert.equal(await computed(darkPage, ".msg.mine .bubble", "color"), DARK_INK_INVERSE);
  assert.equal(await computed(darkPage, ".msg.theirs .bubble", "background-color"), DARK_SOFT, "their bubble is a dark surface");
  assert.equal(await computed(darkPage, ".msg.theirs .bubble", "color"), DARK_INK);
  const box = await darkPage.locator("#msg-form").boundingBox();
  assert.ok(box && box.y >= 0 && box.y + box.height <= 844, "the composer is on screen");
  await dark.close();

  assert.deepEqual(errors, []);
  await tessCtx.close();
  await boCtx.close();
});
