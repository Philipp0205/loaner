import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { useLoaner } from "./harness.js";

const SHOTS = path.resolve("test/ui/screenshots/flow");
const loaner = useLoaner();

test("recovery code: copy it on one phone, sign back in on another, wrong code is refused", { timeout: 90_000 }, async () => {
  const first = await loaner.phone();
  const old = await first.newPage();
  await old.goto(loaner.baseUrl);
  await old.locator("#name").fill("Dana");
  await old.getByRole("button", { name: "Get started" }).click();
  await old.locator("nav.ak-tabbar").waitFor();
  await old.locator(".ak-tabbar").getByRole("button", { name: "You" }).click();
  await old.getByRole("heading", { level: 1, name: "You" }).waitFor();
  const code = (await old.locator("#recovery-code").textContent()) ?? "";
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  await old.getByRole("button", { name: "Copy code" }).click();
  await old.getByText("Recovery code copied").waitFor();
  assert.equal(await old.evaluate(() => navigator.clipboard.readText()), code);
  fs.mkdirSync(SHOTS, { recursive: true });
  await old.screenshot({ path: path.join(SHOTS, "recovery-profile.png") });

  // A new phone: no storage at all.
  const second = await loaner.phone();
  const fresh = await second.newPage();
  await fresh.goto(loaner.baseUrl);
  await fresh.getByRole("button", { name: "I have a recovery code" }).click();
  await fresh.locator("#recover-code").fill("AAAA-BBBB-CCCC");
  await fresh.getByRole("button", { name: "Sign back in" }).click();
  await fresh.getByText("that recovery code did not work").waitFor();
  await fresh.locator("#recover-code").fill(code.toLowerCase());
  await fresh.getByRole("button", { name: "Sign back in" }).click();
  await fresh.locator("nav.ak-tabbar").waitFor();
  // Signing back in is not a new sign-up, so the new phone still gets the What's new sheet.
  const sheet = fresh.getByRole("dialog", { name: "What's new" });
  await sheet.waitFor();
  await sheet.getByRole("button", { name: "Got it" }).click();
  await sheet.waitFor({ state: "detached" });
  await fresh.locator(".ak-tabbar").getByRole("button", { name: "You" }).click();
  assert.equal(await fresh.locator("#profile-name").inputValue(), "Dana");
  await fresh.screenshot({ path: path.join(SHOTS, "recovery-signed-back-in.png") });

  // Making a new code on the new phone retires the old one.
  await fresh.getByRole("button", { name: "Show a recovery code" }).click();
  await fresh.locator("#recovery-code").waitFor();
  const next = (await fresh.locator("#recovery-code").textContent()) ?? "";
  assert.notEqual(next, code);
  await first.close();
  await second.close();
});
