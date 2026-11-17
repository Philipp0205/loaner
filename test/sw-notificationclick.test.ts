import assert from "node:assert/strict";
import test from "node:test";
import { ORIGIN, loadWorker } from "./sw-sandbox.js";

type FakeClient = { url: string; calls: string[]; navigate?: (url: string) => Promise<unknown>; focus: () => Promise<unknown> };

function fakeClient(url: string, calls: string[], options: { navigate?: boolean; navigateFails?: boolean } = {}): FakeClient {
  const client: FakeClient = { url, calls, focus: async () => { calls.push("focus"); return client; } };
  if (options.navigate !== false) {
    client.navigate = async (to) => {
      calls.push(`navigate ${to}`);
      if (options.navigateFails) throw new Error("nope");
      return client;
    };
  }
  return client;
}

// Runs the real sw.js (and the real kit worker it imports) in a sandbox and fires one notificationclick.
async function click(url: string | undefined, makeClients: (calls: string[]) => FakeClient[]): Promise<{ calls: string[]; closed: boolean }> {
  const calls: string[] = [];
  const worker = loadWorker({
    clients: {
      matchAll: async () => makeClients(calls),
      openWindow: async (to: string) => { calls.push(`open ${to}`); return null; },
      claim: () => {},
    },
  });
  let closed = false;
  let pending: Promise<unknown> = Promise.resolve();
  worker.handlers.notificationclick[0]({
    notification: { close: () => { closed = true; }, data: url === undefined ? undefined : { url } },
    waitUntil: (promise: Promise<unknown>) => { pending = promise; },
  });
  await pending;
  return { calls, closed };
}

test("notificationclick: an open window is navigated to the target, then focused", async () => {
  const { calls, closed } = await click("/requests/1", (c) => [fakeClient(`${ORIGIN}/`, c)]);
  assert.deepEqual(calls, [`navigate ${ORIGIN}/requests/1`, "focus"]);
  assert.equal(closed, true);
});

test("notificationclick: a window already on the target is only focused", async () => {
  const { calls } = await click("/requests/1", (c) => [fakeClient(`${ORIGIN}/requests/1`, c)]);
  assert.deepEqual(calls, ["focus"]);
});

test("notificationclick: a cross-origin target is never navigated to", async () => {
  const { calls } = await click("https://evil.example/x", (c) => [fakeClient(`${ORIGIN}/`, c)]);
  assert.deepEqual(calls, ["focus"]);
});

test("notificationclick: other origins' windows are ignored, and with no window it opens one", async () => {
  const { calls } = await click("/alerts", (c) => [fakeClient("https://other.example/", c)]);
  assert.deepEqual(calls, [`open ${ORIGIN}/alerts`]);
  assert.deepEqual((await click(undefined, () => [])).calls, [`open ${ORIGIN}/`]);
});

test("notificationclick: a window that cannot navigate, or fails to, is still focused", async () => {
  assert.deepEqual((await click("/alerts", (c) => [fakeClient(`${ORIGIN}/`, c, { navigate: false })])).calls, ["focus"]);
  assert.deepEqual((await click("/alerts", (c) => [fakeClient(`${ORIGIN}/`, c, { navigateFails: true })])).calls, [`navigate ${ORIGIN}/alerts`, "focus"]);
});
