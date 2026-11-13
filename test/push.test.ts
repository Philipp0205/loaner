import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { createNoopPushSender } from "../src/push.js";
import { api, DAY, joinWith, makeGroup, makeItem, ok, signUp, withApp, type AppCtx, type Person } from "./http.js";

const VAPID = { VAPID_PUBLIC_KEY: "pub-key-for-tests", VAPID_PRIVATE_KEY: "priv-key-for-tests" };
const SUB = { endpoint: "https://push.example.test/abc", keys: { p256dh: "p256-fake", auth: "auth-fake" } };

async function twoPeople(app: AppCtx) {
  const alice = await signUp(app, "Alice");
  const bob = await signUp(app, "Bob");
  const flat = await makeGroup(app, alice, "Flat");
  await joinWith(app, bob, flat.inviteCode);
  const item = await makeItem(app, alice, [flat.id]);
  return { alice, bob, item };
}

const request = (app: AppCtx, bob: Person, item: string, from = "2026-06-02", until = "2026-06-03") =>
  ok(app, "POST", `/api/items/${item}/requests`, { token: bob.token, status: 201, body: { from, until, message: "Please" } });

test("push: sent only when VAPID is configured and the person subscribed", async () => {
  await withApp(async (app) => {
    const { alice, bob, item } = await twoPeople(app);
    await request(app, bob, item);
    assert.equal(app.sent.length, 0, "alice has not subscribed");
    await ok(app, "POST", "/api/push/subscribe", { token: alice.token, body: SUB });
    await request(app, bob, item, "2026-06-10", "2026-06-11");
    assert.equal(app.sent.length, 1);
    assert.equal(app.sent[0].endpoint, SUB.endpoint);
    assert.equal(app.sent[0].payload.title, "New request");
    assert.match(app.sent[0].payload.body, /Bob would like Cordless drill/);
    // Bob never subscribed, so approving sends nothing to him.
    const incoming = (await ok(app, "GET", "/api/requests", { token: alice.token })).requests.filter((r: any) => r.from === "2026-06-10");
    await ok(app, "POST", `/api/requests/${incoming[0].id}/approve`, { token: alice.token });
    assert.equal(app.sent.length, 1);
    await ok(app, "POST", "/api/push/subscribe", { token: bob.token, body: { ...SUB, endpoint: "https://push.example.test/bob" } });
    await ok(app, "POST", `/api/requests/${incoming[0].id}/handover`, { token: alice.token });
    assert.equal(app.sent.length, 2);
    assert.equal(app.sent[1].endpoint, "https://push.example.test/bob");
  }, { env: VAPID });
});

test("push: nothing is sent without VAPID keys, even when subscribed, but in-app notes still exist", async () => {
  await withApp(async (app) => {
    const { alice, bob, item } = await twoPeople(app);
    await ok(app, "POST", "/api/push/subscribe", { token: alice.token, body: SUB });
    await request(app, bob, item);
    assert.equal(app.sent.length, 0);
    assert.equal((await ok(app, "GET", "/api/notifications", { token: alice.token })).notifications.length, 1);
  });
});

test("push: reminders are pushed to subscribed people", async () => {
  await withApp(async (app) => {
    const { alice, bob, item } = await twoPeople(app);
    const { runReminders } = await import("../src/remind.js");
    await ok(app, "POST", "/api/push/subscribe", { token: alice.token, body: SUB });
    await ok(app, "POST", "/api/push/subscribe", { token: bob.token, body: { ...SUB, endpoint: "https://push.example.test/bob" } });
    const r = (await request(app, bob, item)).request;
    await ok(app, "POST", `/api/requests/${r.id}/approve`, { token: alice.token });
    await ok(app, "POST", `/api/requests/${r.id}/handover`, { token: alice.token });
    app.sent.length = 0;
    app.advance(DAY); // 2 June, due 3 June
    await runReminders(app.ctx);
    assert.deepEqual(app.sent.map((s) => s.payload.title), ["Due tomorrow", "Due tomorrow"]);
    assert.deepEqual(app.sent.map((s) => s.endpoint).sort(), [SUB.endpoint, "https://push.example.test/bob"]);
    await runReminders(app.ctx);
    assert.equal(app.sent.length, 2, "once only");
  }, { env: VAPID });
});

test("push: a gone subscription is removed and a failing sender does not break the request", async () => {
  let calls = 0;
  await withApp(async (app) => {
    const { alice, bob, item } = await twoPeople(app);
    await ok(app, "POST", "/api/push/subscribe", { token: alice.token, body: SUB });
    await request(app, bob, item);
    assert.equal(calls, 1);
    assert.equal((app.db.prepare("SELECT COUNT(*) AS n FROM push_subscriptions").get() as any).n, 0, "410 removes it");
    await ok(app, "POST", "/api/push/subscribe", { token: alice.token, body: SUB });
  }, {
    env: VAPID,
    push: { async send() { calls += 1; throw Object.assign(new Error("gone"), { statusCode: 410 }); } },
  });
});

test("push: subscribe validates input and needs a token", async () => {
  await withApp(async (app) => {
    const alice = await signUp(app, "Alice");
    assert.equal((await api(app, "POST", "/api/push/subscribe", { body: SUB })).status, 401);
    assert.equal((await api(app, "POST", "/api/push/subscribe", { token: alice.token, body: { endpoint: "http://insecure.test/x", keys: SUB.keys } })).status, 400);
    assert.equal((await api(app, "POST", "/api/push/subscribe", { token: alice.token, body: { endpoint: SUB.endpoint, keys: {} } })).status, 400);
    await ok(app, "POST", "/api/push/subscribe", { token: alice.token, body: SUB });
    await ok(app, "POST", "/api/push/unsubscribe", { token: alice.token, body: { endpoint: SUB.endpoint } });
    assert.equal((app.db.prepare("SELECT COUNT(*) AS n FROM push_subscriptions").get() as any).n, 0);
  });
});

test("config: VAPID keys come in pairs, defaults are sane", () => {
  assert.throws(() => loadConfig({ VAPID_PUBLIC_KEY: "x" }), /both/i);
  const config = loadConfig({}, "/work");
  assert.equal(config.port, 3000);
  assert.equal(config.tz, "UTC");
  assert.equal(config.vapid, null);
  assert.equal(config.dbPath, "/work/data/loaner.db");
  assert.equal(loadConfig({ DB_PATH: "/tmp/x.db", APP_TZ: "Europe/Berlin" }).tz, "Europe/Berlin");
  assert.throws(() => loadConfig({ APP_TZ: "Mars/Base" }), /APP_TZ/);
  assert.throws(() => loadConfig({ PORT: "0" }), /PORT/);
  void createNoopPushSender;
});
