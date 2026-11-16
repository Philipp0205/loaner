import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createNoopPushSender } from "../src/push.js";
import { api, withApp } from "./http.js";

test("health: GET /api/health is open and answers ok", async () => {
  await withApp(async (app) => {
    const res = await api(app, "GET", "/api/health");
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { ok: true });
  });
});

test("health: a wrong method on the path is 405", async () => {
  await withApp(async (app) => {
    assert.equal((await api(app, "POST", "/api/health")).status, 405);
  });
});

test("health: HEAD answers 200 with no body", async () => {
  await withApp(async (app) => {
    const res = await api(app, "HEAD", "/api/health");
    assert.equal(res.status, 200);
    assert.equal(res.bytes.length, 0);
  });
});

test("health: it still checks the database, so a broken one is a 503 and never {ok:true}", async () => {
  const broken = {
    prepare() {
      throw new Error("database is gone");
    },
  } as unknown as DatabaseSync;
  const config = loadConfig({ PORT: "3000", DB_PATH: ":memory:", APP_TZ: "UTC" });
  const server = http.createServer(createApp({ db: broken, config, now: () => Date.now(), push: createNoopPushSender() }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  try {
    const { port } = server.address() as AddressInfo;
    const res = await api({ port }, "GET", "/api/health");
    assert.equal(res.status, 503);
    assert.deepEqual(res.json, { ok: false });
    assert.equal((await api({ port }, "HEAD", "/api/health")).status, 503);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
