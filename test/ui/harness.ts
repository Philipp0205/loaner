import http from "node:http";
import type { AddressInfo } from "node:net";
import type { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { chromium, type Browser, type BrowserContext } from "playwright-core";
import { createApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { openDb } from "../../src/db.js";
import { createNoopPushSender } from "../../src/push.js";

/** Android Chrome on a Pixel 8. */
export const UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36";
export const PHONE = { width: 390, height: 844 };

export type Server = { baseUrl: string; db: DatabaseSync; close: () => Promise<void> };

/** Headless Chrome: the installed channel, else the system binary. `args` are extra Chrome flags for one spec. */
export async function launchChrome(args: string[] = []): Promise<Browser> {
  try {
    return await chromium.launch({ channel: "chrome", headless: true, args });
  } catch {
    return await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true, args });
  }
}

/** The app on 127.0.0.1 with a random port and an in-memory db. */
export async function startServer(env: NodeJS.ProcessEnv = {}): Promise<Server> {
  const db = openDb(":memory:");
  const config = loadConfig({ PORT: "3000", DB_PATH: ":memory:", APP_TZ: "UTC", ...env });
  const server = http.createServer(createApp({ db, config, push: createNoopPushSender(), now: () => Date.now() }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    baseUrl,
    db,
    async close() {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
    },
  };
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
    /** A fresh phone-sized browser context: its own storage, so its own person. */
    async phone(): Promise<BrowserContext> {
      const context = await live(browser).newContext({
        viewport: PHONE,
        isMobile: true,
        hasTouch: true,
        userAgent: UA,
        permissions: ["clipboard-read", "clipboard-write"],
      });
      context.on("dialog", (dialog) => void dialog.accept());
      return context;
    },
  };
}
