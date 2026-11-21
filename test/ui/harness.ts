import http from "node:http";
import type { AddressInfo } from "node:net";
import type { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { chromium, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from "playwright-core";
import { hashSecret, stubMailer, type Mailer, type MailMessage } from "../../src/app-kit/index.ts";
import { createApp } from "../../src/app.js";
import { createGroupChat, type GroupChat } from "../../src/chat/service.js";
import { loadConfig } from "../../src/config.js";
import { openDb } from "../../src/db.js";
import { createNoopPushSender } from "../../src/push.js";

/** Android Chrome on a Pixel 8. */
export const UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36";
export const PHONE = { width: 390, height: 844 };

export type Server = { baseUrl: string; db: DatabaseSync; mail: Mailer & { sent: MailMessage[] }; chat: GroupChat; close: () => Promise<void> };

/** Headless Chrome: the installed channel, else the system binary. `args` are extra Chrome flags for one spec. */
export async function launchChrome(args: string[] = []): Promise<Browser> {
  try {
    return await chromium.launch({ channel: "chrome", headless: true, args });
  } catch {
    return await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true, args });
  }
}

/** The app on 127.0.0.1 with a random port, an in-memory db and a mail stub (no real mail is ever sent). */
export async function startServer(env: NodeJS.ProcessEnv = {}): Promise<Server> {
  const db = openDb(":memory:");
  const config = loadConfig({ PORT: "3000", DB_PATH: ":memory:", APP_TZ: "UTC", ...env });
  const mail = stubMailer();
  const ctx = { db, config, push: createNoopPushSender(), now: () => Date.now() };
  const chat = createGroupChat(ctx);
  const server = http.createServer(createApp({ ...ctx, mailer: mail, chat }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // Links in mail open on this server.
  config.appOrigin = baseUrl;
  return {
    baseUrl,
    db,
    mail,
    chat,
    async close() {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      chat.dispose();
      db.close();
    },
  };
}

/** Opens the signed-out welcome screen. Signed-out `/` is the home page now, so the welcome form lives at `/app`. */
export async function openWelcome(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/app`);
  await page.locator("#name").waitFor();
}

/** The default address for a test person: the name, lowercased, at example.com. */
export const emailFor = (name: string): string => `${name.toLowerCase().replace(/[^a-z0-9]/g, "") || "user"}@example.com`;

/** Fills the name and email fields of a sign-up or join form. */
export async function fillSignup(page: Page, name: string, email = emailFor(name)): Promise<void> {
  await page.locator("#name").fill(name);
  await page.locator("#email").fill(email);
}

/** Creates an account through the welcome form and waits for the signed-in app (the tab bar). The caller checks what comes next. */
export async function signUp(page: Page, baseUrl: string, name: string): Promise<void> {
  await openWelcome(page, baseUrl);
  await fillSignup(page, name);
  await page.getByRole("button", { name: "Get started" }).click();
  await page.locator("nav.ak-tabbar").waitFor();
}

/** An account from before email was required: no address, a recovery code to sign in with. Returns that code. */
export function seedLegacyUser(db: DatabaseSync, name: string, code = "ABCD-EFGH-JKLM"): string {
  db.prepare("INSERT INTO users (id, name, recovery_hash, created_at) VALUES (?, ?, ?, ?)").run(`legacy-${name.toLowerCase()}`, name, hashSecret(code), Date.now());
  return code;
}

/** The token in the link of a mail: `.../verify#t=TOKEN` or `.../recover#t=TOKEN`. */
export function linkFrom(message: MailMessage | undefined, kind: "verify" | "recover"): string {
  const match = new RegExp(`(https?://[^\\s]+/${kind}#t=[A-Za-z0-9_-]+)`).exec(message?.text ?? "");
  if (!match) throw new Error(`no ${kind} link in the mail`);
  return match[1];
}

/** The bell in the header of a main tab, and its unread badge. Alerts have no tab in the bar. */
export const bell = (page: Page) => page.locator("[data-alerts-bell]");
export const bellBadge = (page: Page) => page.locator("[data-alerts-bell] .ak-badge");

/** Taps the header bell and waits for the Alerts screen. */
export async function openAlerts(page: Page): Promise<void> {
  await bell(page).click();
  await page.getByRole("heading", { level: 1, name: "Alerts" }).waitFor();
}

/** Registers test.before and test.after. Read baseUrl and browser inside tests. `env` is passed to the server's config, `chromeArgs` to Chrome. */
export function useLoaner(env: NodeJS.ProcessEnv = {}, chromeArgs: string[] = []) {
  let server: Server | undefined;
  let browser: Browser | undefined;
  test.before(async () => {
    server = await startServer(env);
    browser = await launchChrome(chromeArgs);
  });
  test.after(async () => {
    await browser?.close();
    await server?.close();
  });
  const live = <T>(value: T | undefined): T => {
    if (value === undefined) throw new Error("useLoaner: test.before has not run yet");
    return value;
  };
  return {
    get baseUrl() { return live(server).baseUrl; },
    get db() { return live(server).db; },
    get mail() { return live(server).mail; },
    get chat() { return live(server).chat; },
    /** A fresh phone-sized browser context: its own storage, so its own person. `options` override the phone defaults, e.g. `{ colorScheme: "dark" }`. */
    async phone(options: BrowserContextOptions = {}): Promise<BrowserContext> {
      const context = await live(browser).newContext({
        viewport: PHONE,
        isMobile: true,
        hasTouch: true,
        userAgent: UA,
        permissions: ["clipboard-read", "clipboard-write"],
        ...options,
      });
      context.on("dialog", (dialog) => void dialog.accept());
      return context;
    },
  };
}
