import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "playwright-core";
import { openWelcome, useLoaner } from "./harness.js";

const loaner = useLoaner();

const tab = (page: Page, name: string) => page.locator(".ak-tabbar").getByRole("button", { name }).click();
const bubbles = (page: Page) => page.locator(".ak-chat-msg .ak-chat-body");
const chatButton = (page: Page) => page.locator("section.card[data-group] [data-chat-open]");

async function send(page: Page, text: string) {
  await page.locator(".ak-chat-input").fill(text);
  await page.locator(".ak-chat-send").click();
}

async function openChat(page: Page) {
  await tab(page, "Browse");
  await tab(page, "You");
  await chatButton(page).click();
  await page.locator(".ak-chat-composer").waitFor();
}

test("two members chat, see unread on the You card, and mute sticks", { timeout: 120_000 }, async () => {
  const errors: string[] = [];
  const tessCtx = await loaner.phone();
  const boCtx = await loaner.phone({ colorScheme: "dark" });
  const outCtx = await loaner.phone();
  const tess = await tessCtx.newPage();
  const bo = await boCtx.newPage();
  const out = await outCtx.newPage();
  for (const [page, who] of [[tess, "tess"], [bo, "bo"], [out, "out"]] as const) {
    page.on("pageerror", (error) => errors.push(`${who}: ${error}`));
    page.on("console", (msg) => { if (msg.type() === "error" && !/404/.test(msg.text())) errors.push(`${who} console: ${msg.text()}`); });
  }

  // Tess makes a group and Bo joins.
  await openWelcome(tess, loaner.baseUrl);
  await tess.locator("#name").fill("Tess");
  await tess.locator("#email").fill("tess@example.com");
  await tess.getByRole("button", { name: "Get started" }).click();
  await tess.getByRole("heading", { name: "No groups yet" }).waitFor();
  await tess.locator("#group-name").fill("Flat 3B");
  await tess.getByRole("button", { name: "Create group" }).click();
  await tess.locator("#group-switch").waitFor();
  await tab(tess, "You");
  await tess.getByRole("button", { name: "Copy invite link" }).click();
  await tess.getByText("Invite link copied").waitFor();
  const invite = await tess.evaluate(() => navigator.clipboard.readText());
  await bo.goto(invite);
  await bo.locator("#name").fill("Bo");
  await bo.locator("#email").fill("bo@example.com");
  await bo.getByRole("button", { name: "Join Flat 3B" }).click();
  await bo.locator("nav.ak-tabbar").waitFor();

  // Tess opens the chat, which fills the screen above the tab bar, and says hello.
  await chatButton(tess).click();
  await tess.locator(".ak-chat-composer").waitFor();
  assert.match(tess.url(), /#\/group\/[^/]+\/chat$/);
  assert.equal(await tess.locator("#chat-mute").getAttribute("aria-pressed"), "false");
  const pane = await tess.locator(".ak-chat").boundingBox();
  assert.ok(pane && pane.height > 300, `the pane has a real height (${pane?.height})`);
  await send(tess, "Anyone need the drill?");
  await bubbles(tess).filter({ hasText: "Anyone need the drill?" }).waitFor();

  // Bo sees the unread badge on the You card, then the message in the chat.
  await tab(bo, "Browse");
  await tab(bo, "You");
  const badge = bo.locator("[data-chat-unread]");
  await badge.waitFor();
  assert.equal((await badge.textContent())?.trim(), "1");
  await chatButton(bo).click();
  await bubbles(bo).filter({ hasText: "Anyone need the drill?" }).waitFor();
  await send(bo, "Yes please");

  // Tess's open chat picks the reply up by polling.
  await bubbles(tess).filter({ hasText: "Yes please" }).waitFor({ timeout: 15_000 });
  assert.equal(await bubbles(tess).count(), 2);

  // Opening cleared Bo's badge.
  await bo.goBack();
  await bo.locator("section.card[data-group]").first().waitFor();
  assert.equal(await bo.locator("[data-chat-unread]").count(), 0, "no badge once read");

  // Mute sticks across a reload.
  await openChat(bo);
  await bo.locator("#chat-mute").click();
  await bo.waitForFunction(() => document.querySelector("#chat-mute")?.getAttribute("aria-pressed") === "true");
  await bo.reload();
  await bo.locator("#chat-mute").waitFor();
  assert.equal(await bo.locator("#chat-mute").getAttribute("aria-pressed"), "true");

  // Someone outside the group gets the error screen, not the chat.
  const groupId = tess.url().match(/group\/([^/]+)\/chat/)![1];
  await openWelcome(out, loaner.baseUrl);
  await out.locator("#name").fill("Cara");
  await out.locator("#email").fill("cara@example.com");
  await out.getByRole("button", { name: "Get started" }).click();
  await out.locator("nav.ak-tabbar").waitFor();
  await out.goto(`${loaner.baseUrl}/app#/group/${groupId}/chat`);
  await out.locator("nav.ak-tabbar").waitFor();
  await out.waitForTimeout(500);
  assert.equal(await out.locator(".ak-chat").count(), 0, "a non-member never gets the pane");

  assert.deepEqual(errors, []);
});
