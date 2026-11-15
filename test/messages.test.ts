import assert from "node:assert/strict";
import test from "node:test";
import { api, joinWith, makeGroup, makeItem, ok, signUp, withApp, type AppCtx, type Person } from "./http.js";

const VAPID = { VAPID_PUBLIC_KEY: "pub-key-for-tests", VAPID_PRIVATE_KEY: "priv-key-for-tests" };
const SUB = { endpoint: "https://push.example.test/abc", keys: { p256dh: "p256-fake", auth: "auth-fake" } };

async function setup(app: AppCtx) {
  const alice = await signUp(app, "Alice"); // owner
  const bob = await signUp(app, "Bob"); // borrower
  const carol = await signUp(app, "Carol"); // third group member
  const mallory = await signUp(app, "Mallory"); // stranger, no group
  const flat = await makeGroup(app, alice, "Flat");
  await joinWith(app, bob, flat.inviteCode);
  await joinWith(app, carol, flat.inviteCode);
  const item = await makeItem(app, alice, [flat.id]);
  return { alice, bob, carol, mallory, flat, item };
}

const path = (item: string, borrower?: string) => `/api/items/${item}/messages${borrower ? `?borrower=${borrower}` : ""}`;
const say = (app: AppCtx, who: Person, item: string, body: unknown, borrower?: string) =>
  api(app, "POST", path(item, borrower), { token: who.token, body: { body } });
const read = (app: AppCtx, who: Person, item: string, borrower?: string) =>
  api(app, "GET", path(item, borrower), { token: who.token });
const requests = async (app: AppCtx, who: Person, role?: "outgoing") =>
  (await ok(app, "GET", `/api/requests${role ? "?role=outgoing" : ""}`, { token: who.token })).requests as { id: string; unreadMessages: boolean }[];

test("messages: borrower writes, owner reads and replies, borrower sees the reply", async () => {
  await withApp(async (app) => {
    const { alice, bob, item } = await setup(app);
    const first = await say(app, bob, item, "Is the drill free on Saturday?");
    assert.equal(first.status, 201);
    assert.equal(first.json.message.senderId, bob.id);
    assert.equal(first.json.message.body, "Is the drill free on Saturday?");

    const owner = await read(app, alice, item, bob.id);
    assert.equal(owner.status, 200);
    assert.deepEqual(owner.json.thread.item, { id: item, name: "Cordless drill" });
    assert.deepEqual(owner.json.thread.owner, { id: alice.id, name: "Alice" });
    assert.deepEqual(owner.json.thread.borrower, { id: bob.id, name: "Bob" });
    assert.deepEqual(owner.json.thread.messages.map((m: any) => [m.senderId, m.body]), [[bob.id, "Is the drill free on Saturday?"]]);

    assert.equal((await say(app, alice, item, "Yes, come by after 10.", bob.id)).status, 201);
    const borrower = await read(app, bob, item);
    assert.deepEqual(borrower.json.thread.messages.map((m: any) => [m.senderId, m.body]), [
      [bob.id, "Is the drill free on Saturday?"],
      [alice.id, "Yes, come by after 10."],
    ]);
    assert.deepEqual(Object.keys(borrower.json.thread.messages[0]).sort(), ["body", "createdAt", "id", "senderId"]);
    assert.equal(
      (app.db.prepare("SELECT COUNT(*) AS n FROM messages").get() as any).n, 2);
  });
});

test("messages: the same thread is used before and after a request, and a request carries the unread flag", async () => {
  await withApp(async (app) => {
    const { alice, bob, item } = await setup(app);
    await say(app, bob, item, "Before asking");
    await ok(app, "POST", `/api/items/${item}/requests`, { token: bob.token, status: 201, body: { from: "2026-06-05", until: "2026-06-06", message: "Please" } });
    await say(app, alice, item, "Sure, ask away", bob.id);
    // A second request for the same item over time stays in the one thread.
    await say(app, bob, item, "After asking");
    const seen = await read(app, alice, item, bob.id);
    assert.deepEqual(seen.json.thread.messages.map((m: any) => m.body), ["Before asking", "Sure, ask away", "After asking"]);
    // The request's own note and reply are untouched.
    const [incoming] = await requests(app, alice);
    assert.equal((await ok(app, "GET", `/api/requests/${incoming.id}`, { token: alice.token })).request.message, "Please");
    assert.equal((app.db.prepare("SELECT reply FROM requests").get() as any).reply, "");
  });
});

test("messages: body validation. empty, blank, missing and 1001 characters are 400, 1000 is fine", async () => {
  await withApp(async (app) => {
    const { bob, item } = await setup(app);
    for (const bad of ["", "   ", "\n\n \t", undefined, null, 5, "x".repeat(1001), "😀".repeat(1001)]) {
      assert.equal((await say(app, bob, item, bad)).status, 400, JSON.stringify(bad)?.slice(0, 20));
    }
    assert.equal((await api(app, "POST", path(item), { token: bob.token, body: {} })).status, 400, "missing body");
    assert.equal((await api(app, "POST", path(item), { token: bob.token })).status, 400, "no json at all");
    assert.equal((await say(app, bob, item, "x".repeat(1000))).status, 201);
    assert.equal((await say(app, bob, item, "😀".repeat(1000))).status, 201, "counted in code points");
    assert.equal((app.db.prepare("SELECT COUNT(*) AS n FROM messages").get() as any).n, 2, "rejected messages are not stored");
  });
});

test("messages: the body is trimmed at the ends and keeps its own line breaks", async () => {
  await withApp(async (app) => {
    const { alice, bob, item } = await setup(app);
    const sent = await say(app, bob, item, "  \n Hello\n\nSee you  at   10 \n ");
    assert.equal(sent.status, 201);
    assert.equal(sent.json.message.body, "Hello\n\nSee you  at   10");
    const got = await read(app, alice, item, bob.id);
    assert.equal(got.json.thread.messages[0].body, "Hello\n\nSee you  at   10");
  });
});

test("messages: HTML is stored and returned as plain text", async () => {
  await withApp(async (app) => {
    const { alice, bob, item } = await setup(app);
    const html = `<img src=x onerror="alert(1)"><script>alert(2)</script> & "quotes"`;
    assert.equal((await say(app, bob, item, html)).status, 201);
    const got = await read(app, alice, item, bob.id);
    assert.match(got.type, /^application\/json/);
    assert.equal(got.json.thread.messages[0].body, html, "not sanitised into tags, not escaped, just text");
    assert.equal(typeof got.json.thread.messages[0].body, "string");
    assert.equal((app.db.prepare("SELECT body FROM messages").get() as any).body, html);
    assert.equal(JSON.parse(got.bytes.toString("utf8")).thread.messages[0].body, html, "the JSON carries it as one string value");
  });
});

test("messages: access. no token is 401, strangers and other members get 404, nobody messages themselves", async () => {
  await withApp(async (app) => {
    const { alice, bob, carol, mallory, item } = await setup(app);
    await say(app, bob, item, "Private between Bob and Alice");

    assert.equal((await api(app, "GET", path(item))).status, 401);
    assert.equal((await api(app, "POST", path(item), { body: { body: "hi" } })).status, 401);

    // A stranger cannot see the item at all.
    assert.equal((await read(app, mallory, item)).status, 404);
    assert.equal((await say(app, mallory, item, "hi")).status, 404);
    assert.equal((await read(app, mallory, item, bob.id)).status, 404);
    assert.equal((await read(app, mallory, "nope")).status, 404);
    assert.equal((await read(app, mallory, item)).json.error, "item not found");

    // Another group member cannot open or write into Bob's thread.
    assert.equal((await read(app, carol, item, bob.id)).status, 404);
    assert.equal((await say(app, carol, item, "hi", bob.id)).status, 404);
    assert.equal((await read(app, carol, item, alice.id)).status, 404);
    // Her own thread with the owner is separate and empty.
    const own = await read(app, carol, item);
    assert.equal(own.status, 200);
    assert.deepEqual(own.json.thread.messages, []);
    assert.doesNotMatch(JSON.stringify(own.json), /Private between/);

    // Bob cannot post as someone else, or read as someone else.
    assert.equal((await say(app, bob, item, "hi", alice.id)).status, 404);
    assert.equal((await say(app, bob, item, "hi", carol.id)).status, 404);
    assert.equal((await read(app, bob, item, carol.id)).status, 404);

    // The owner cannot invent a thread, or write to themselves.
    assert.equal((await read(app, alice, item, "no-such-user")).status, 404);
    assert.equal((await say(app, alice, item, "hi", "no-such-user")).status, 404);
    assert.equal((await say(app, alice, item, "hi", mallory.id)).status, 404, "a user who cannot see the item");
    assert.equal((await say(app, alice, item, "hi", alice.id)).status, 404, "not to themselves");
    assert.equal((await say(app, alice, item, "hi")).status, 400, "the owner must name the borrower");
    assert.equal((app.db.prepare("SELECT COUNT(*) AS n FROM messages").get() as any).n, 1);
  });
});

test("messages: an owner can reply to a borrower who left the group, and can start with a member who has not written", async () => {
  await withApp(async (app) => {
    const { alice, bob, carol, flat, item } = await setup(app);
    // A group member who has never written: the owner may start, since the borrower can see the item.
    assert.equal((await say(app, alice, item, "Need the drill, Carol?", carol.id)).status, 201);
    assert.equal((await read(app, carol, item)).json.thread.messages.length, 1);
    // Bob writes, then the item leaves his group: the thread already has messages, so the owner can still answer. Bob loses the item.
    await say(app, bob, item, "Hi");
    app.db.prepare("DELETE FROM memberships WHERE user_id = ?").run(bob.id);
    assert.equal((await read(app, bob, item)).status, 404, "the borrower can no longer see the item");
    assert.equal((await say(app, alice, item, "Sorry you left", bob.id)).status, 201);
    assert.ok(flat.id);
  });
});

test("messages: unread. the recipient has it until they open the thread", async () => {
  await withApp(async (app) => {
    const { alice, bob, item } = await setup(app);
    await ok(app, "POST", `/api/items/${item}/requests`, { token: bob.token, status: 201, body: { from: "2026-06-05", until: "2026-06-06" } });
    const detail = (who: Person) => ok(app, "GET", `/api/items/${item}`, { token: who.token });

    assert.equal((await requests(app, alice))[0].unreadMessages, false);
    assert.equal((await detail(bob)).unreadMessages, false);

    await say(app, bob, item, "Hello");
    assert.equal((await requests(app, alice))[0].unreadMessages, true, "owner has an unread message");
    assert.equal((await requests(app, bob, "outgoing"))[0].unreadMessages, false, "the sender never has their own as unread");
    app.advance(1000);
    await say(app, alice, item, "Hi Bob", bob.id);
    assert.equal((await requests(app, bob, "outgoing"))[0].unreadMessages, true, "borrower has an unread reply");
    assert.equal((await detail(bob)).unreadMessages, true);
    assert.equal((await detail(alice)).unreadMessages, false, "owners have no single thread on the item");
    assert.equal((await requests(app, alice))[0].unreadMessages, true, "still unread for the owner: Bob wrote before Alice looked");

    // Opening the thread marks it read for that person only.
    await read(app, alice, item, bob.id);
    assert.equal((await requests(app, alice))[0].unreadMessages, false);
    assert.equal((await requests(app, bob, "outgoing"))[0].unreadMessages, true, "Bob has not opened it");
    await read(app, bob, item);
    assert.equal((await requests(app, bob, "outgoing"))[0].unreadMessages, false);
    assert.equal((await detail(bob)).unreadMessages, false);

    // A message sent in the same millisecond as the last read is still seen as new.
    await say(app, bob, item, "One more");
    await say(app, bob, item, "And another");
    assert.equal((await requests(app, alice))[0].unreadMessages, true);
    await read(app, alice, item, bob.id);
    assert.equal((await requests(app, alice))[0].unreadMessages, false);
  });
});

test("messages: opening a thread marks its alert read, and the alert says where to go", async () => {
  await withApp(async (app) => {
    const { alice, bob, item } = await setup(app);
    await say(app, bob, item, "Hello");
    const before = await ok(app, "GET", "/api/notifications", { token: alice.token });
    assert.equal(before.unread, 1);
    const note = before.notifications[0];
    assert.equal(note.type, "message");
    assert.equal(note.itemId, item);
    assert.equal(note.borrowerId, bob.id);
    await read(app, alice, item, bob.id);
    assert.equal((await ok(app, "GET", "/api/notifications", { token: alice.token })).unread, 0);
  });
});

test("messages: the alert and push to the other person are short and never carry the message text", async () => {
  await withApp(async (app) => {
    const { alice, bob, item } = await setup(app);
    await ok(app, "POST", "/api/push/subscribe", { token: alice.token, body: SUB });
    await ok(app, "POST", "/api/push/subscribe", { token: bob.token, body: { ...SUB, endpoint: "https://push.example.test/bob" } });
    const secret = "my secret garage code is 4242";
    await say(app, bob, item, secret);

    assert.equal(app.sent.length, 1, "only the other person is pushed");
    assert.equal(app.sent[0].endpoint, SUB.endpoint);
    assert.equal(app.sent[0].payload.title, "New message");
    assert.equal(app.sent[0].payload.body, "Bob sent you a message about Cordless drill.");
    assert.equal(app.sent[0].payload.tag, `message:${item}:${bob.id}`);
    assert.ok(!JSON.stringify(app.sent[0].payload).includes("4242"));

    app.advance(1000);
    await say(app, alice, item, "reply with another secret 9999", bob.id);
    assert.equal(app.sent.length, 2);
    assert.equal(app.sent[1].endpoint, "https://push.example.test/bob");
    assert.equal(app.sent[1].payload.body, "Alice sent you a message about Cordless drill.");
    assert.equal(app.sent[1].payload.tag, `message:${item}:${bob.id}`, "same thread, same tag, so a burst collapses");
    assert.ok(!JSON.stringify(app.sent[1].payload).includes("9999"));

    for (const who of [alice, bob]) {
      const notes = (await ok(app, "GET", "/api/notifications", { token: who.token })).notifications as { type: string; title: string; body: string }[];
      const mine = notes.filter((n) => n.type === "message");
      assert.equal(mine.length, 1);
      assert.equal(mine[0].title, "New message");
      assert.ok(!/secret|4242|9999/.test(mine[0].title + mine[0].body));
    }
  }, { env: VAPID });
});

test("messages: a failing push does not lose the message", async () => {
  await withApp(async (app) => {
    const { alice, bob, item } = await setup(app);
    await ok(app, "POST", "/api/push/subscribe", { token: alice.token, body: SUB });
    assert.equal((await say(app, bob, item, "still saved")).status, 201);
    assert.equal((await read(app, alice, item, bob.id)).json.thread.messages.length, 1);
  }, { env: VAPID, push: { async send() { throw new Error("boom"); } } });
});

test("messages: a paused item can still be talked about, and a deleted item takes its threads with it", async () => {
  await withApp(async (app) => {
    const { alice, bob, item } = await setup(app);
    await ok(app, "PATCH", `/api/items/${item}`, { token: alice.token, body: { available: false } });
    assert.equal((await say(app, bob, item, "Is it back soon?")).status, 201);
    await ok(app, "DELETE", `/api/items/${item}`, { token: alice.token });
    assert.equal((app.db.prepare("SELECT COUNT(*) AS n FROM messages").get() as any).n, 0);
    assert.equal((app.db.prepare("SELECT COUNT(*) AS n FROM message_reads").get() as any).n, 0);
    assert.equal((await read(app, bob, item)).status, 404);
  });
});

test("messages: a thread view returns the newest messages in time order", async () => {
  await withApp(async (app) => {
    const { alice, bob, item } = await setup(app);
    for (let i = 1; i <= 3; i += 1) {
      await say(app, i % 2 ? bob : alice, item, `m${i}`, i % 2 ? undefined : bob.id);
    }
    const got = (await read(app, bob, item)).json.thread.messages;
    assert.deepEqual(got.map((m: any) => m.body), ["m1", "m2", "m3"]);
    assert.ok(got[0].createdAt < got[1].createdAt && got[1].createdAt < got[2].createdAt, "strictly increasing even in one millisecond");
  });
});
