import assert from "node:assert/strict";
import test from "node:test";
import type { BrowserContext, Page } from "playwright-core";
import { fillSignup, linkFrom, openWelcome, seedLegacyUser, signUp, useLoaner } from "./harness.js";
import { skipWhatsNew } from "./whats-new-seen.js";

const loaner = useLoaner();
const PAYPAL = "https://www.paypal.me/philippkurrle1";

/** The stub mailer finishes in a few ticks. This waits them out so a lost-code mail (sent without being awaited) is visible. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
}

const mailTo = (email: string) => loaner.mail.sent.filter((message) => message.to === email);

const tabbar = (page: Page) => page.locator("nav.ak-tabbar");
const banner = (page: Page) => page.locator("#confirm-banner");

async function openApp(page: Page) {
  await openWelcome(page, loaner.baseUrl);
}

/** A new person signs up, makes a group and returns the invite link read off the You tab. */
async function hostWithInvite(context: BrowserContext, name: string, group: string): Promise<string> {
  const page = await context.newPage();
  await signUp(page, loaner.baseUrl, name);
  await page.locator("#group-name").fill(group);
  await page.getByRole("button", { name: "Create group" }).click();
  await page.locator("#group-switch").waitFor();
  await page.locator(".ak-tabbar").getByRole("button", { name: "You" }).click();
  const link = page.locator(".invite-link").first();
  await link.waitFor();
  const invite = (await link.innerText()).trim();
  assert.match(invite, new RegExp(`^${loaner.baseUrl}/join/[A-Z0-9]{10}$`));
  await page.close();
  return invite;
}

/** Signs a legacy account in from the welcome form's recovery code. Leaves the page on whatever shows next. */
async function recoverWith(page: Page, code: string) {
  await page.getByRole("button", { name: "I have a recovery code" }).click();
  await page.locator("#recover-code").fill(code);
  await page.getByRole("button", { name: "Sign back in" }).click();
}

/** The legacy person is in the group: a row in the db, and Browse shows that group. */
async function assertJoined(page: Page, userId: string, group: string) {
  await tabbar(page).waitFor();
  await page.locator("#group-switch").waitFor();
  assert.equal(await page.locator("#group-switch option:checked").textContent(), group);
  const row = loaner.db.prepare("SELECT COUNT(*) AS n FROM memberships m JOIN groups g ON g.id = m.group_id WHERE m.user_id = ? AND g.name = ?").get(userId, group) as { n: number };
  assert.equal(row.n, 1, `${userId} is a member of ${group}`);
}

test("sign-up needs an email: the form will not send without one, then it lands in the app with a confirm banner", { timeout: 90_000 }, async () => {
  const context = await loaner.phone();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const before = (loaner.db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
  await openApp(page);

  // Name only: the browser blocks the submit, so nothing is sent and nobody is created.
  await page.locator("#name").fill("Nora");
  await page.getByRole("button", { name: "Get started" }).click();
  assert.equal(await page.locator("#email").evaluate((el) => (el as HTMLInputElement).validity.valueMissing), true);
  assert.equal(await tabbar(page).count(), 0);
  assert.equal((loaner.db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n, before);

  // A malformed address is refused by the server with a plain message.
  await page.locator("#email").fill("nora@nowhere");
  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByText("that email does not look right").first().waitFor();
  assert.equal(await tabbar(page).count(), 0);

  await fillSignup(page, "Nora", "nora@example.com");
  await page.getByRole("button", { name: "Get started" }).click();
  await tabbar(page).waitFor();
  await banner(page).waitFor();
  assert.match((await banner(page).textContent()) ?? "", /nora@example\.com/);
  assert.equal(mailTo("nora@example.com").length, 1, "one confirm link was mailed");

  // Send again mails a fresh link.
  await page.getByRole("button", { name: "Send again" }).click();
  await page.getByText("Link sent").waitFor();
  assert.equal(mailTo("nora@example.com").length, 2);
  assert.deepEqual(errors, []);
  await context.close();
});

test("the confirm link works after a press, the page never uses it on its own, and the banner goes away", { timeout: 90_000 }, async () => {
  const context = await loaner.phone();
  const page = await context.newPage();
  await openApp(page);
  await fillSignup(page, "Vera", "vera@example.com");
  await page.getByRole("button", { name: "Get started" }).click();
  await banner(page).waitFor();

  const link = linkFrom(mailTo("vera@example.com")[0], "verify");
  const linkPage = await context.newPage();
  await linkPage.goto(link);
  await linkPage.getByRole("heading", { name: "Confirm your email" }).waitFor();
  // Opening the page did not use the link.
  assert.equal((loaner.db.prepare("SELECT email_verified_at AS at FROM users WHERE email = 'vera@example.com'").get() as { at: number | null }).at, null);
  await linkPage.getByRole("button", { name: "Confirm my email" }).click();
  await linkPage.getByRole("heading", { name: "Email confirmed" }).waitFor();
  assert.equal(new URL(linkPage.url()).hash, "", "the token is removed from the address bar");
  assert.notEqual((loaner.db.prepare("SELECT email_verified_at AS at FROM users WHERE email = 'vera@example.com'").get() as { at: number | null }).at, null);

  await linkPage.getByRole("link", { name: "Open Loan some" }).click();
  await tabbar(linkPage).waitFor();
  assert.equal(await banner(linkPage).count(), 0, "a confirmed address has no banner");
  await linkPage.locator(".ak-tabbar").getByRole("button", { name: "You" }).click();
  await linkPage.locator("#email-card").waitFor();
  assert.match((await linkPage.locator("#email-status").textContent()) ?? "", /vera@example\.com is confirmed/);

  // The same link a second time is a plain message, not a crash.
  const again = await context.newPage();
  await again.goto(link);
  await again.getByRole("button", { name: "Confirm my email" }).click();
  await again.getByText("that link did not work").first().waitFor();
  await context.close();
});

test("an account from before email was required must add one before anything else loads", { timeout: 90_000 }, async () => {
  const code = seedLegacyUser(loaner.db, "Lena");
  const context = await loaner.phone();
  await skipWhatsNew(context);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await openApp(page);
  await page.getByRole("button", { name: "I have a recovery code" }).click();
  await page.locator("#recover-code").fill(code);
  await page.getByRole("button", { name: "Sign back in" }).click();

  await page.getByRole("heading", { name: "Add your email" }).waitFor();
  assert.equal(await tabbar(page).count(), 0, "no tab bar, so nothing to tap past it");
  assert.equal(await page.getByRole("button", { name: "Sign out of this phone" }).count(), 0);
  assert.equal(await page.locator("#root").getByRole("button", { name: /close|skip|later|not now/i }).count(), 0, "the screen cannot be dismissed");

  // Reloading does not get around it.
  await page.reload();
  await page.getByRole("heading", { name: "Add your email" }).waitFor();

  await page.locator("#email").fill("lena@example.com");
  await page.getByRole("button", { name: "Save email" }).click();
  await tabbar(page).waitFor();
  await banner(page).waitFor();
  assert.equal(mailTo("lena@example.com").length, 1);
  assert.deepEqual(errors.filter((message) => !/403/.test(message)), []);
  await context.close();
});

test("a legacy account that recovers from an invite link adds an email and then joins that group", { timeout: 120_000 }, async () => {
  const hostContext = await loaner.phone();
  const invite = await hostWithInvite(hostContext, "Hana", "Gwen Flat");

  const code = seedLegacyUser(loaner.db, "Gwen", "BCDF-GHJK-MNPQ");
  const context = await loaner.phone();
  await skipWhatsNew(context);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(invite);
  await page.getByRole("heading", { name: "Join Gwen Flat?" }).waitFor();
  await recoverWith(page, code);

  // No email yet, so the add-email step comes first and she is not in the group yet.
  await page.getByRole("heading", { name: "Add your email" }).waitFor();
  assert.equal(await tabbar(page).count(), 0);
  assert.equal(loaner.db.prepare("SELECT COUNT(*) AS n FROM memberships WHERE user_id = 'legacy-gwen'").get()!.n, 0);

  await page.locator("#email").fill("gwen@example.com");
  await page.getByRole("button", { name: "Save email" }).click();
  await assertJoined(page, "legacy-gwen", "Gwen Flat");
  await page.getByText("You joined Gwen Flat").waitFor();
  await banner(page).waitFor();
  assert.equal(await page.evaluate(() => sessionStorage.getItem("loaner_pending_invite")), null, "the pending invite is used up");
  assert.deepEqual(errors.filter((message) => !/403/.test(message)), []);
  await context.close();
  await hostContext.close();
});

test("a signed-in legacy account opening an invite link adds an email first, then joins on its own", { timeout: 120_000 }, async () => {
  const hostContext = await loaner.phone();
  const invite = await hostWithInvite(hostContext, "Ines", "Theo Flat");

  const code = seedLegacyUser(loaner.db, "Theo", "RSTV-WXYZ-2345");
  const context = await loaner.phone();
  await skipWhatsNew(context);
  const page = await context.newPage();
  await openApp(page);
  await recoverWith(page, code);
  await page.getByRole("heading", { name: "Add your email" }).waitFor();
  assert.ok(await page.evaluate(() => localStorage.getItem("loaner_token")), "a device token is stored and the account still has no email");

  // Now the invite: the add-email step names the group, not a dead-end "add an email first".
  await page.goto(invite);
  await page.getByRole("heading", { name: "Add your email" }).waitFor();
  assert.match((await page.locator("#add-email-why").textContent()) ?? "", /To join Theo Flat/);
  assert.equal(await page.getByText("add an email first").count(), 0);
  assert.equal(loaner.db.prepare("SELECT COUNT(*) AS n FROM memberships WHERE user_id = 'legacy-theo'").get()!.n, 0);

  await page.locator("#email").fill("theo@example.com");
  await page.getByRole("button", { name: "Save email" }).click();
  await assertJoined(page, "legacy-theo", "Theo Flat");
  await page.getByText("You joined Theo Flat").waitFor();
  assert.equal(new URL(page.url()).pathname, "/", "the invite is gone from the address bar");
  await context.close();
  await hostContext.close();
});

test("the confirm banner and the You tab email card clear without a reload when the address is confirmed elsewhere", { timeout: 120_000 }, async () => {
  const context = await loaner.phone();
  const page = await context.newPage();
  await openApp(page);
  await fillSignup(page, "Mira", "mira@example.com");
  await page.getByRole("button", { name: "Get started" }).click();
  await banner(page).waitFor();
  await page.evaluate(() => ((window as unknown as { noReload: boolean }).noReload = true));
  await page.locator(".ak-tabbar").getByRole("button", { name: "You" }).click();
  await page.locator("#email-card").waitFor();
  assert.match((await page.locator("#email-status").textContent()) ?? "", /Not confirmed yet/);

  // Another tab opens the mailed link and confirms.
  const other = await context.newPage();
  await other.goto(linkFrom(mailTo("mira@example.com")[0], "verify"));
  await other.getByRole("button", { name: "Confirm my email" }).click();
  await other.getByRole("heading", { name: "Email confirmed" }).waitFor();

  // Back on the first tab: a focus (and the light interval) is enough, no reload.
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await banner(page).waitFor({ state: "detached", timeout: 15_000 });
  await page.locator("#email-status").getByText("mira@example.com is confirmed").waitFor({ timeout: 5_000 });
  assert.equal(await page.evaluate(() => (window as unknown as { noReload?: boolean }).noReload), true, "the page was not reloaded");
  await context.close();
});

test("a lost recovery code: the email link signs in on a new phone and shows a new code once", { timeout: 120_000 }, async () => {
  // A person with a confirmed address.
  const first = await loaner.phone();
  const old = await first.newPage();
  await openApp(old);
  await fillSignup(old, "Rosa", "rosa@example.com");
  await old.getByRole("button", { name: "Get started" }).click();
  await banner(old).waitFor();
  await old.locator(".ak-tabbar").getByRole("button", { name: "You" }).click();
  const oldCode = (await old.locator("#recovery-code").textContent()) ?? "";
  assert.match(oldCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const verify = await first.newPage();
  await verify.goto(linkFrom(mailTo("rosa@example.com")[0], "verify"));
  await verify.getByRole("button", { name: "Confirm my email" }).click();
  await verify.getByRole("heading", { name: "Email confirmed" }).waitFor();

  // A second person who never confirmed.
  const other = await loaner.phone();
  const otherPage = await other.newPage();
  await openApp(otherPage);
  await fillSignup(otherPage, "Ugo", "ugo@example.com");
  await otherPage.getByRole("button", { name: "Get started" }).click();
  await banner(otherPage).waitFor();

  // A new phone asks for a link.
  const second = await loaner.phone();
  await skipWhatsNew(second);
  const fresh = await second.newPage();
  await openApp(fresh);
  await fresh.getByRole("button", { name: "I have a recovery code" }).click();
  await fresh.getByRole("button", { name: "Email me a new code" }).click();

  // The unconfirmed address gets the same answer and no mail.
  await fresh.locator("#lost-email").fill("ugo@example.com");
  await fresh.getByRole("button", { name: "Email me a link" }).click();
  await fresh.locator("#lost-code-sent").waitFor();
  const neutral = await fresh.locator("#lost-code-sent").textContent();
  await flush();
  assert.equal(mailTo("ugo@example.com").filter((message) => /\/recover#t=/.test(message.text)).length, 0, "no sign-in link for an unconfirmed address");

  await fresh.getByRole("button", { name: "Back" }).click();
  await fresh.getByRole("button", { name: "Email me a new code" }).click();
  await fresh.locator("#lost-email").fill("rosa@example.com");
  await fresh.getByRole("button", { name: "Email me a link" }).click();
  await fresh.locator("#lost-code-sent").waitFor();
  assert.equal(await fresh.locator("#lost-code-sent").textContent(), neutral, "the same words for both");
  await flush();
  const lost = mailTo("rosa@example.com").filter((message) => /\/recover#t=/.test(message.text));
  assert.equal(lost.length, 1);
  assert.ok(!lost[0].text.includes(oldCode), "the recovery code is not in the mail");

  // Open the link, press the button, get in.
  const linkPage = await second.newPage();
  await linkPage.goto(linkFrom(lost[0], "recover"));
  await linkPage.getByRole("heading", { name: "Sign in to Loan some" }).waitFor();
  assert.equal(await tabbar(linkPage).count(), 0, "opening the link does not sign anyone in");
  await linkPage.getByRole("button", { name: "Sign me in" }).click();
  await linkPage.getByRole("heading", { name: "You are back in" }).waitFor();
  assert.equal(new URL(linkPage.url()).hash, "", "the token is removed from the address bar");
  const newCode = (await linkPage.locator("#new-recovery-code").textContent()) ?? "";
  assert.match(newCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.notEqual(newCode, oldCode);
  await linkPage.getByRole("button", { name: "Continue" }).click();
  await tabbar(linkPage).waitFor();
  await linkPage.locator(".ak-tabbar").getByRole("button", { name: "You" }).click();
  assert.equal(await linkPage.locator("#profile-name").inputValue(), "Rosa");
  assert.equal(await linkPage.locator("#recovery-code").textContent(), newCode, "the new code is kept on this phone");

  // The link is single use, and the old code is dead.
  const reuse = await second.newPage();
  await reuse.goto(linkFrom(lost[0], "recover"));
  await reuse.getByRole("button", { name: "Sign me in" }).click();
  await reuse.getByText("that link did not work").first().waitFor();
  await first.close();
  await other.close();
  await second.close();
});

test("the Donate button opens the kit sheet with a PayPal link and nothing else", { timeout: 90_000 }, async () => {
  const context = await loaner.phone();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await openApp(page);
  await fillSignup(page, "Dora", "dora@example.com");
  await page.getByRole("button", { name: "Get started" }).click();
  await tabbar(page).waitFor();
  await page.locator(".ak-tabbar").getByRole("button", { name: "You" }).click();
  await page.getByRole("heading", { level: 1, name: "You" }).waitFor();

  // It sits under About, next to What's new and Send feedback.
  const donate = page.locator("#open-donate");
  await donate.scrollIntoViewIfNeeded();
  assert.equal(await donate.textContent(), "Donate");
  assert.equal(await page.locator("#open-whats-new").count(), 1);
  assert.equal(await page.locator("#open-feedback").count(), 1);

  await donate.click();
  const sheet = page.locator(".ak-sheet");
  await sheet.waitFor();
  const link = sheet.locator("a.ak-btn");
  assert.equal(await link.count(), 1, "one link, no amounts");
  assert.equal(await link.getAttribute("href"), PAYPAL);
  assert.equal(await link.getAttribute("target"), "_blank");
  assert.match((await link.getAttribute("rel")) ?? "", /noopener/);
  assert.match((await link.getAttribute("rel")) ?? "", /noreferrer/);
  assert.equal(await sheet.locator(".ak-chip").count(), 0, "no amount chips");
  assert.ok(requests.every((url) => !/paypal/i.test(url)), "the app never talks to PayPal, it only offers a link");
  assert.deepEqual(errors, []);
  await context.close();
});
