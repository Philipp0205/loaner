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
  console.log("Loan some");
  console.log(`  listening  http://localhost:${config.port}`);
  console.log(`  database   ${config.dbPath}`);
  console.log(`  timezone   ${config.tz}`);
  console.log(config.vapid ? "  web push   enabled" : "  web push   off (no VAPID keys), in-app notifications still work");
});

const FORCE_EXIT_MS = 8000;
let shuttingDown = false;
let dbClosed = false;

function closeDb(): void {
  if (dbClosed) return;
  dbClosed = true;
  try {
    db.close();
  } catch (error) {
    console.error("db close failed", error instanceof Error ? error.message : error);
  }
}

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Loan some stopping on ${signal}`);
  clearInterval(reminderTimer);
  // If close hangs on a keep-alive socket, exit cleanly anyway.
  setTimeout(() => {
    closeDb();
    process.exit(0);
  }, FORCE_EXIT_MS).unref();
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  server.closeIdleConnections();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
