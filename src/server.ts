import http from "node:http";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { createNoopPushSender, createWebPushSender } from "./push.js";
import { runReminders } from "./remind.js";

const config = loadConfig();
const db = openDb(config.dbPath);
const push = config.vapid ? createWebPushSender(config.vapid) : createNoopPushSender();
const ctx = { db, config, now: () => Date.now(), push };

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

const server = http.createServer(createApp(ctx));
server.listen(config.port, "0.0.0.0", () => {
  console.log("Loaner");
  console.log(`  listening  http://localhost:${config.port}`);
  console.log(`  database   ${config.dbPath}`);
  console.log(`  timezone   ${config.tz}`);
  console.log(config.vapid ? "  web push   enabled" : "  web push   off (no VAPID keys), in-app notifications still work");
});

function shutdown(): void {
  clearInterval(reminderTimer);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
