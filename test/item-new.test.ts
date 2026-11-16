import assert from "node:assert/strict";
import test from "node:test";
import { joinWith, makeGroup, makeItem, ok, signUp, TINY_PNG, withApp, type AppCtx, type Person } from "./http.js";

const VAPID = { VAPID_PUBLIC_KEY: "pub-key-for-tests", VAPID_PRIVATE_KEY: "priv-key-for-tests" };
const SUB = { endpoint: "https://push.example.test/bob", keys: { p256dh: "p256-fake", auth: "auth-fake" } };

type Note = { type: string; title: string; body: string; itemId: string | null; read: boolean };
const notes = async (app: AppCtx, who: Person) =>
  (await ok(app, "GET", "/api/notifications", { token: who.token })).notifications as Note[];

/** Alice owns Flat (Bob, Carol) and Club (Carol, Dave). Erin is only in Other. */
async function world(app: AppCtx) {
  const alice = await signUp(app, "Alice");
  const bob = await signUp(app, "Bob");
  const carol = await signUp(app, "Carol");
  const dave = await signUp(app, "Dave");
  const erin = await signUp(app, "Erin");
  const flat = await makeGroup(app, alice, "Flat");
  const club = await makeGroup(app, alice, "Club");
  const other = await makeGroup(app, erin, "Other");
  await joinWith(app, bob, flat.inviteCode);
  await joinWith(app, carol, flat.inviteCode);
  await joinWith(app, carol, club.inviteCode);
  await joinWith(app, dave, club.inviteCode);
  return { alice, bob, carol, dave, erin, flat, club, other };
}

test("item added: other members of the shared group get an item_new note with the item id", async () => {
  await withApp(async (app) => {
    const { alice, bob, carol, flat } = await world(app);
    const item = await makeItem(app, alice, [flat.id]);
    for (const who of [bob, carol]) {
      const mine = await notes(app, who);
      assert.equal(mine.length, 1);
      assert.equal(mine[0].type, "item_new");
      assert.equal(mine[0].title, "Alice added Cordless drill");
      assert.equal(mine[0].body, "It's now on the shelf.");
      assert.equal(mine[0].itemId, item);
      assert.equal(mine[0].read, false);
    }
  });
});

test("item added: the owner is never told about their own item", async () => {
  await withApp(async (app) => {
    const { alice, flat, club } = await world(app);
    await makeItem(app, alice, [flat.id, club.id]);
    assert.deepEqual(await notes(app, alice), []);
    assert.equal((await ok(app, "GET", "/api/me", { token: alice.token })).unread, 0);
  });
});

test("item added: a member of two of the item's groups gets one note", async () => {
  await withApp(async (app) => {
    const { alice, bob, carol, dave, flat, club } = await world(app);
    await makeItem(app, alice, [flat.id, club.id]);
    assert.deepEqual((await notes(app, carol)).map((n) => n.type), ["item_new"]);
    assert.deepEqual((await notes(app, bob)).map((n) => n.type), ["item_new"]);
    assert.deepEqual((await notes(app, dave)).map((n) => n.type), ["item_new"]);
  });
});

test("item added: members of groups the item is not shared with get nothing", async () => {
  await withApp(async (app) => {
    const { alice, bob, carol, dave, erin, flat } = await world(app);
    await makeItem(app, alice, [flat.id]);
    assert.equal((await notes(app, bob)).length, 1);
    assert.equal((await notes(app, carol)).length, 1, "carol is in Flat");
    assert.deepEqual(await notes(app, dave), [], "dave is only in Club");
    assert.deepEqual(await notes(app, erin), [], "erin is only in Other");
  });
});

test("item added: editing, photo changes and pausing do not notify again", async () => {
  await withApp(async (app) => {
    const { alice, bob, flat, club } = await world(app);
    const item = await makeItem(app, alice, [flat.id]);
    assert.equal((await notes(app, bob)).length, 1);
    await ok(app, "PATCH", `/api/items/${item}`, { token: alice.token, body: { name: "Big drill", note: "New note", available: false, groupIds: [flat.id, club.id] } });
    await ok(app, "PUT", `/api/items/${item}/photo`, { token: alice.token, raw: TINY_PNG, contentType: "image/png" });
    await ok(app, "DELETE", `/api/items/${item}/photo`, { token: alice.token });
    assert.equal((await notes(app, bob)).length, 1, "still only the first note");
  });
});

test("item added: a failed create sends no notes", async () => {
  await withApp(async (app) => {
    const { alice, bob, erin, flat, other } = await world(app);
    await ok(app, "POST", "/api/items", { token: alice.token, status: 400, body: { name: "Drill", groupIds: [other.id] } });
    await ok(app, "POST", "/api/items", { token: alice.token, status: 400, body: { name: "", groupIds: [flat.id] } });
    assert.deepEqual(await notes(app, bob), []);
    assert.deepEqual(await notes(app, erin), []);
  });
});

test("item added: push goes to subscribed members with a tag for the item", async () => {
  await withApp(async (app) => {
    const { alice, bob, carol, flat } = await world(app);
    await ok(app, "POST", "/api/push/subscribe", { token: bob.token, body: SUB });
    await ok(app, "POST", "/api/push/subscribe", { token: alice.token, body: { ...SUB, endpoint: "https://push.example.test/alice" } });
    const item = await makeItem(app, alice, [flat.id]);
    assert.equal(app.sent.length, 1, "only bob is subscribed, and alice is the owner");
    assert.equal(app.sent[0].endpoint, SUB.endpoint);
    assert.equal(app.sent[0].payload.title, "Alice added Cordless drill");
    assert.equal(app.sent[0].payload.body, "It's now on the shelf.");
    assert.equal(app.sent[0].payload.tag, `item_new:${item}`);
    assert.equal((await notes(app, carol)).length, 1, "carol still has the in-app note");
  }, { env: VAPID });
});

test("item added: a failing push does not stop the item being created", async () => {
  await withApp(async (app) => {
    const { alice, bob, flat } = await world(app);
    await ok(app, "POST", "/api/push/subscribe", { token: bob.token, body: SUB });
    const item = await makeItem(app, alice, [flat.id]);
    assert.ok(item);
    assert.equal((await notes(app, bob)).length, 1);
  }, { env: VAPID, push: { async send() { throw new Error("push service down"); } } });
});
