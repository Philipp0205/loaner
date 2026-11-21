import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { ORIGIN, loadWorker } from "./sw-sandbox.js";

const SERVER_ROUTES = new Set(["/", "/app", "/welcome"]);

test("sw.js imports the kit worker and sets it up for Loan some", () => {
  const worker = loadWorker();
  assert.deepEqual(worker.imported, ["/app-kit/ak-sw.js"]);
  const options = worker.setupOptions()!;
  assert.equal(options.version, "v26");
  assert.equal(options.prefix, "loaner");
  assert.deepEqual([...options.networkOnly], ["/api/"]);
  assert.equal(options.offlineFallback, "/");
});

test("every shell URL is a real file in public/ or one of the server routes", () => {
  const shell: string[] = [...loadWorker().setupOptions()!.shell];
  assert.ok(shell.length > 50, `${shell.length} shell entries`);
  assert.equal(new Set(shell).size, shell.length, "no duplicates");
  for (const url of shell) {
    if (SERVER_ROUTES.has(url)) continue;
    const path = url.split("?")[0];
    assert.ok(fs.existsSync(new URL(`../public${path}`, import.meta.url)), `${url} is in the shell but not in public/`);
  }
  for (const file of ["/app-kit/ak-native.css", "/app-kit/ak-view-transitions.css", "/app-kit/ak-native.js", "/app-kit/ak-transition.js", "/app-kit/ak-swr.js", "/app-kit/ak-sw-register.js", "/css/native.css"]) {
    assert.ok(shell.includes(file), file);
  }
});

test("install precaches the shell and does not skip waiting, so the page can offer the update", async () => {
  const worker = loadWorker();
  let pending: Promise<unknown> = Promise.resolve();
  worker.handlers.install[0]({ waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
  await pending;
  assert.equal(worker.added.length, 1);
  assert.equal(worker.added[0].length, worker.setupOptions()!.shell.length);
  assert.ok(!worker.log.includes("skipWaiting"), "install must not call skipWaiting");
});

test("a SKIP_WAITING message takes over, and any other message does not", () => {
  const worker = loadWorker();
  const message = worker.handlers.message[0];
  message({ data: { type: "something-else" } });
  assert.deepEqual(worker.log, []);
  message({ data: { type: "SKIP_WAITING" } });
  assert.deepEqual(worker.log, ["skipWaiting"]);
});

test("activate deletes the old caches, including the pre-kit loaner-v23, and claims the page", async () => {
  const deleted: string[] = [];
  const worker = loadWorker({
    caches: {
      open: async () => ({ addAll: async () => {} }),
      keys: async () => ["loaner-v23", "loaner-shell-v26", "loaner-shell-v22", "other-app-cache"],
      delete: async (key: string) => { deleted.push(key); return true; },
    },
  });
  let pending: Promise<unknown> = Promise.resolve();
  worker.handlers.activate[0]({ waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
  await pending;
  assert.deepEqual(deleted.sort(), ["loaner-shell-v22", "loaner-v23"]);
  assert.ok(worker.log.includes("claim"));
});

test("the API is never answered by the worker, and the push handlers still come first", () => {
  const worker = loadWorker();
  const answered: string[] = [];
  const ask = (path: string) => {
    const request = { method: "GET", url: `${ORIGIN}${path}`, mode: "cors", headers: { has: () => false } };
    for (const handler of worker.handlers.fetch) handler({ request, respondWith: () => { answered.push(path); }, waitUntil: () => {} });
  };
  ask("/api/items/mine");
  assert.deepEqual(answered, [], "/api/ is left to the network");
  assert.equal(typeof worker.handlers.push[0], "function");
  assert.equal(typeof worker.handlers.notificationclick[0], "function");
});
