import assert from "node:assert/strict";
import type http from "node:http";
import test from "node:test";
import { clientKey } from "../src/client-key.js";
import { api, withApp, type AppCtx } from "./http.js";

function fakeReq(forwarded: string | string[] | undefined, remoteAddress: string | undefined = "10.0.0.1"): http.IncomingMessage {
  return { headers: forwarded === undefined ? {} : { "x-forwarded-for": forwarded }, socket: { remoteAddress } } as unknown as http.IncomingMessage;
}

test("clientKey: the rightmost forwarded hop is the client, left-hand hops are ignored", () => {
  assert.equal(clientKey(fakeReq("203.0.113.9")), "203.0.113.9");
  assert.equal(clientKey(fakeReq("1.1.1.1, 2.2.2.2, 203.0.113.9")), "203.0.113.9");
  assert.equal(clientKey(fakeReq("  1.1.1.1 ,  203.0.113.9  ")), "203.0.113.9");
  assert.equal(clientKey(fakeReq("2001:db8::1")), "2001:db8::1");
});

test("clientKey: a missing, empty or invalid header falls back to the socket address", () => {
  assert.equal(clientKey(fakeReq(undefined)), "10.0.0.1");
  assert.equal(clientKey(fakeReq("")), "10.0.0.1");
  assert.equal(clientKey(fakeReq(" , ,")), "10.0.0.1");
  assert.equal(clientKey(fakeReq("1.1.1.1, bad/hop")), "10.0.0.1");
  assert.equal(clientKey(fakeReq("1.1.1.1, bad hop")), "10.0.0.1");
  assert.equal(clientKey(fakeReq("a".repeat(129))), "10.0.0.1");
  assert.equal(clientKey(fakeReq(undefined, "")), "unknown");
});

test("clientKey: an array header uses its first value", () => {
  assert.equal(clientKey(fakeReq(["1.1.1.1, 203.0.113.9", "5.5.5.5"])), "203.0.113.9");
  assert.equal(clientKey(fakeReq([])), "10.0.0.1");
});

const via = (hop: string): Record<string, string> => ({ "x-forwarded-for": `198.51.100.1, ${hop}` });

async function recoverStatuses(app: AppCtx, count: number, headers?: Record<string, string>): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) out.push((await api(app, "POST", "/api/auth/recover", { body: { code: "AAAA-BBBB-CCCC" }, headers })).status);
  return out;
}

test("rate limits: recover buckets are per forwarded client", async () => {
  await withApp(async (app) => {
    const first = await recoverStatuses(app, 11, via("203.0.113.1"));
    assert.equal(first[9], 401);
    assert.equal(first[10], 429);
    assert.deepEqual(await recoverStatuses(app, 1, via("203.0.113.2")), [401]);
    assert.deepEqual(await recoverStatuses(app, 1, via("203.0.113.1")), [429]);
  });
});

test("rate limits: a changing left-hand hop does not escape the bucket", async () => {
  await withApp(async (app) => {
    for (let i = 0; i < 10; i += 1) await recoverStatuses(app, 1, { "x-forwarded-for": `9.9.9.${i}, 203.0.113.1` });
    assert.deepEqual(await recoverStatuses(app, 1, { "x-forwarded-for": "8.8.8.8, 203.0.113.1" }), [429]);
  });
});

test("rate limits: requests without a forwarded header share the socket address bucket", async () => {
  await withApp(async (app) => {
    const statuses = await recoverStatuses(app, 11);
    assert.equal(statuses[10], 429);
    assert.deepEqual(await recoverStatuses(app, 1, via("203.0.113.3")), [401]);
  });
});

test("rate limits: start buckets are per forwarded client", async () => {
  await withApp(async (app) => {
    const start = async (headers?: Record<string, string>) => (await api(app, "POST", "/api/auth/start", { body: { name: "Pat" }, headers })).status;
    for (let i = 0; i < 60; i += 1) assert.equal(await start(via("203.0.113.1")), 200);
    assert.equal(await start(via("203.0.113.1")), 429);
    assert.equal(await start(via("203.0.113.2")), 200);
    assert.equal(await start(), 200);
  });
});
