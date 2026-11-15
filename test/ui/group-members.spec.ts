import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "playwright-core";
import { useLoaner } from "./harness.js";

const loaner = useLoaner();

const tab = (page: Page, name: string) => page.locator(".ak-tabbar").getByRole("button", { name }).click();

/** Stubs only the subscription: the same POST the app makes after the browser hands over a push subscription. */
async function subscribe(page: Page, who: string): Promise<void> {
  const status = await page.evaluate(async (name) => {
    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${localStorage.getItem("loaner_token")}` },
      body: JSON.stringify({ endpoint: `https://push.example.test/${name}`, keys: { p256dh: "p256-fake", auth: "auth-fake" } }),
    });
    return res.status;
  }, who);
  assert.equal(status, 200);
}

async function openYou(page: Page) {
  await tab(page, "Browse");
  await tab(page, "You");
  const card = page.locator("section.card[data-group]");
  await card.getByRole("heading", { name: "Members" }).waitFor();
  return card;
}

test("the You tab lists the members and who has notifications on", { timeout: 90_000 }, async () => {
  const errors: string[] = [];
  const tessCtx = await loaner.phone();
  const boCtx = await loaner.phone({ colorScheme: "dark" });
  const tess = await tessCtx.newPage();
  const bo = await boCtx.newPage();
  for (const [page, who] of [[tess, "tess"], [bo, "bo"]] as const) {
    page.on("pageerror", (error) => errors.push(`${who}: ${error}`));
    page.on("console", (msg) => { if (msg.type() === "error") errors.push(`${who} console: ${msg.text()}`); });
  }

  // Tess signs up and creates a group.
  await tess.goto(loaner.baseUrl);
  await tess.locator("#name").fill("Tess");
  await tess.getByRole("button", { name: "Get started" }).click();
  await tess.getByRole("heading", { name: "No groups yet" }).waitFor();
  await tess.locator("#group-name").fill("Flat 3B");
  await tess.getByRole("button", { name: "Create group" }).click();
  await tess.locator("#group-switch").waitFor();
  await tab(tess, "You");
  const tessCard = tess.locator("section.card[data-group]");
  await tessCard.getByRole("button", { name: "Copy invite link" }).click();
  await tess.getByText("Invite link copied").waitFor();
  const invite = await tess.evaluate(() => navigator.clipboard.readText());

  // Bo joins with the link.
  await bo.goto(invite);
  await bo.getByRole("heading", { name: "Join Flat 3B?" }).waitFor();
  await bo.locator("#name").fill("Bo");
  await bo.getByRole("button", { name: "Join Flat 3B" }).click();
  await bo.locator("nav.ak-tabbar").waitFor();

  // Nobody has notifications on yet.
  let card = await openYou(bo);
  let rows = card.locator("li.member");
  assert.equal(await rows.count(), 2);
  assert.equal(await rows.filter({ hasText: "Notifications off" }).count(), 2);
  assert.equal(await card.getByText("Notifications on", { exact: false }).count(), 0);

  // Tess turns notifications on. Only the subscription is stubbed.
  await subscribe(tess, "tess");

  // Tess sees herself marked as You, on, and Bo off.
  card = await openYou(tess);
  rows = card.locator("li.member");
  assert.equal(await rows.count(), 2);
  const tessRow = rows.filter({ hasText: "Tess" });
  const boRow = rows.filter({ hasText: "Bo" });
  assert.equal((await tessRow.locator(".sub").innerText()).trim(), "You \u00b7 Notifications on");
  assert.equal((await boRow.locator(".sub").innerText()).trim(), "Notifications off");
  assert.equal((await tessRow.locator(".avatar").innerText()).trim(), "T");
  assert.equal((await boRow.locator(".avatar").innerText()).trim(), "B");
  assert.equal(await card.getByText("You", { exact: true }).count(), 0, "You is joined to the reach line, not a separate badge");

  // Bo, in dark mode, sees Tess on and himself off with the You marker.
  card = await openYou(bo);
  rows = card.locator("li.member");
  assert.equal((await rows.filter({ hasText: "Tess" }).locator(".sub").innerText()).trim(), "Notifications on");
  assert.equal((await rows.filter({ hasText: "Bo" }).locator(".sub").innerText()).trim(), "You \u00b7 Notifications off");
  assert.equal(await bo.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches), true);
  await card.getByRole("heading", { name: "Members" }).waitFor();
  assert.equal(await rows.first().isVisible(), true);

  // Dark mode uses the page tokens: no light card, readable text, no sideways scroll.
  const look = await bo.evaluate(() => {
    const cardEl = document.querySelector("section.card[data-group]")!;
    const name = document.querySelector("li.member b")!;
    const sub = document.querySelector("li.member .sub")!;
    return {
      card: getComputedStyle(cardEl).backgroundColor, page: getComputedStyle(document.body).backgroundColor,
      name: getComputedStyle(name).color, sub: getComputedStyle(sub).color,
      scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth,
    };
  });
  const lum = (css: string) => {
    const [r, g, b] = (css.match(/[\d.]+/g) ?? ["0", "0", "0"]).slice(0, 3).map(Number).map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  assert.ok(lum(look.card) < 0.2, `the card is dark in dark mode (${look.card})`);
  assert.ok(lum(look.page) < 0.2, `the page is dark in dark mode (${look.page})`);
  assert.ok(lum(look.name) > lum(look.card), "names are lighter than the card");
  assert.ok(lum(look.sub) > lum(look.card), "labels are lighter than the card");
  assert.equal(look.scroll, look.client, "no horizontal scroll");

  assert.deepEqual(errors, []);
  await tessCtx.close();
  await boCtx.close();
});
