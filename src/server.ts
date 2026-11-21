import http from "node:http";
import { installGracefulShutdown } from "./app-kit/index.ts";
import { createApp } from "./app.js";
import { createGroupChat } from "./chat/service.js";
import { loadConfig, isProduction } from "./config.js";
import { openDb } from "./db.js";
import { createNoopPushSender, createWebPushSender } from "./push.js";
import { runReminders } from "./remind.js";

const config = loadConfig();
const db = openDb(config.dbPath);
const push = config.vapid ? createWebPushSender(config.vapid) : createNoopPushSender();
const ctx = { db, config, now: () => Date.now(), push };
const groupChat = createGroupChat(ctx);

let reminding = false;
function remindNow(): void {
  if (reminding) return;
  reminding = true;
  runReminders(ctx)
    .catch((error: unknown) => console.error("reminders failed", error instanceof Error ? error.message : error))
    .finally(() => {
      reminding = false;
    });
}
remindNow();
const reminderTimer = setInterval(remindNow, 5 * 60 * 1000);
reminderTimer.unref?.();

const server = http.createServer(createApp({ ...ctx, chat: groupChat }));
server.listen(config.port, "0.0.0.0", () => {
  console.log("Loan some");
  console.log(`  listening  http://localhost:${config.port}`);
  console.log(`  database   ${config.dbPath}`);
  console.log(`  timezone   ${config.tz}`);
  console.log(config.vapid ? "  web push   enabled" : "  web push   off (no VAPID keys), in-app notifications still work");
  console.log(config.resendApiKey ? "  email      on" : "  email      off (no RESEND_API_KEY), links and lost-code mail are not sent");
  // Without a mailer nobody can confirm an address or get a lost-code link. Say so loudly in production.
  if (!config.resendApiKey && isProduction(process.env)) console.warn("WARNING: RESEND_API_KEY is not set in production, so no email is sent");
});

installGracefulShutdown({
  server,
  forceExitMs: 8000,
  // The kit logs once, as soon as shutdown starts, so this is also where the reminder timer stops.
  log: (message) => {
    clearInterval(reminderTimer);
    console.log(`Loan some ${message}`);
  },
  onClose: async () => {
    // Queued chat pushes go out first, while the database is still open.
    try {
      await groupChat.close();
    } catch (error) {
      console.error("chat flush failed", error instanceof Error ? error.name : "unknown");
    }
    try {
      db.close();
    } catch (error) {
      console.error("db close failed", error instanceof Error ? error.message : error);
    }
  },
});
