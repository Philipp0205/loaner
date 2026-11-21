import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { CHAT_SQLITE_SCHEMA } from "../src/app-kit/index.ts";
import { migrateChat } from "../src/chat/schema.js";
import { pushLine } from "../src/chat/service.js";
import { sqliteChatStore } from "../src/chat/store.js";
import { openDb } from "../src/db.js";
import { api, joinWith, makeGroup, ok, signUp, withApp, type AppCtx, type Person } from "./http.js";

const VAPID = { VAPID_PUBLIC_KEY: "pub-key-for-tests", VAPID_PRIVATE_KEY: "priv-key-for-tests" };
const sub = (name: string) => ({ endpoint: `https://push.example.test/${name}`, keys: { p256dh: "p256-fake", auth: "auth-fake" } });

const chatPath = (group: string, tail = "") => `/api/groups/${group}/chat${tail}`;
const say = (app: AppCtx, who: Person, group: string, text: string) => api(app, "POST", chatPath(group), { token: who.token, body: { text } });

/** Alice makes "Flat" and Bob joins. */
async function flat(app: AppCtx) {
  const alice = await signUp(app, "Alice");
  const bob = await signUp(app, "Bob");
  const group = await makeGroup(app, alice, "Flat");
  await joinWith(app, bob, group.inviteCode);
  return { alice, bob, group };
}

// ---------- the store ----------

function seededDb() {
  const db = openDb(":memory:");
  const user = db.prepare("INSERT INTO users (id, name, recovery_hash, created_at) VALUES (?, ?, ?, 1)");
  user.run("u1", "Ann", "h1");
  user.run("u2", "Ben", "h2");
  db.prepare("INSERT INTO groups (id, name, invite_code, created_by, created_at) VALUES ('g1', 'Flat', 'CODE1', 'u1', 1)").run();
  db.prepare("INSERT INTO groups (id, name, invite_code, created_by, created_at) VALUES ('g2', 'Club', 'CODE2', 'u1', 1)").run();
  for (const id of ["g1", "g2"]) db.prepare("INSERT INTO chats (id, created_at, group_id) VALUES (?, 1, ?)").run(id, id);
  return db;
}

test("chat store: the newest messages come back oldest first, with the author's name", () => {
  const db = seededDb();
  const store = sqliteChatStore(db);
  store.insertMessage({ id: "m1", chatId: "g1", userId: "u1", body: "one", createdAt: 10 });
  store.insertMessage({ id: "m2", chatId: "g1", userId: "u2", body: "two", createdAt: 20 });
  store.insertMessage({ id: "m3", chatId: "g1", userId: "u1", body: "three", createdAt: 30 });
  store.insertMessage({ id: "other", chatId: "g2", userId: "u1", body: "elsewhere", createdAt: 15 });
  const all = store.listMessages("g1", 10) as { id: string; userName: string; chatId: string }[];
  assert.deepEqual(all.map((m) => m.id), ["m1", "m2", "m3"]);
  assert.deepEqual(all.map((m) => m.userName), ["Ann", "Ben", "Ann"]);
  assert.ok(all.every((m) => m.chatId === "g1"));
  assert.deepEqual((store.listMessages("g1", 2) as { id: string }[]).map((m) => m.id), ["m2", "m3"], "the newest two, oldest first");
  db.close();
});

test("chat store: unread counts skip your own messages and start after your read time", () => {
  const db = seededDb();
  const store = sqliteChatStore(db);
  store.insertMessage({ id: "m1", chatId: "g1", userId: "u1", body: "a", createdAt: 10 });
  store.insertMessage({ id: "m2", chatId: "g1", userId: "u2", body: "b", createdAt: 20 });
  store.insertMessage({ id: "m3", chatId: "g1", userId: "u2", body: "c", createdAt: 30 });
  assert.deepEqual(store.unreadCounts("u1", ["g1", "g2"]), { g1: 2, g2: 0 }, "Ann's own message does not count, and g2 is present with 0");
  assert.deepEqual(store.unreadCounts("u2", ["g1"]), { g1: 1 });
  store.setReadAt("u1", "g1", 20);
  assert.deepEqual(store.unreadCounts("u1", ["g1"]), { g1: 1 }, "only what is newer than the read time");
  store.setReadAt("u1", "g1", 30);
  store.setReadAt("u1", "g1", 31);
  assert.deepEqual(store.unreadCounts("u1", ["g1"]), { g1: 0 });
  db.close();
});

test("chat store: mute is stored per person and cleared again", () => {
  const db = seededDb();
  const store = sqliteChatStore(db);
  assert.equal(store.isMuted("u1", "g1"), false);
  store.setMuted("u1", "g1", true);
  store.setMuted("u1", "g1", true);
  assert.equal(store.isMuted("u1", "g1"), true);
  assert.equal(store.isMuted("u2", "g1"), false);
  assert.equal(store.isMuted("u1", "g2"), false);
  store.setMuted("u1", "g1", false);
  assert.equal(store.isMuted("u1", "g1"), false);
  db.close();
});

test("chat schema: a chat is tied to one group, and removing a group or a user removes the chat rows", () => {
  const db = seededDb();
  const store = sqliteChatStore(db);
  assert.throws(() => db.prepare("INSERT INTO chats (id, created_at, group_id) VALUES ('x', 1, 'g1')").run(), /UNIQUE/);
  assert.throws(() => db.prepare("INSERT INTO chats (id, created_at, group_id) VALUES ('y', 1, 'nope')").run(), /FOREIGN KEY/);
  store.insertMessage({ id: "m1", chatId: "g1", userId: "u2", body: "a", createdAt: 10 });
  store.setMuted("u2", "g1", true);
  store.setReadAt("u2", "g1", 5);
  db.prepare("DELETE FROM users WHERE id = 'u2'").run();
  for (const table of ["chat_messages", "chat_mutes", "chat_reads"]) {
    assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n, 0, table);
  }
  store.insertMessage({ id: "m2", chatId: "g1", userId: "u1", body: "b", createdAt: 11 });
  db.prepare("DELETE FROM groups WHERE id = 'g1'").run();
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM chats WHERE id = 'g1'").get() as { n: number }).n, 0);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM chat_messages").get() as { n: number }).n, 0);
  db.close();
});

test("chat migration: an old chats table with no group_id gets the column, and running twice is fine", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("CREATE TABLE users (id TEXT PRIMARY KEY); CREATE TABLE groups (id TEXT PRIMARY KEY);");
  db.exec(CHAT_SQLITE_SCHEMA);
  db.prepare("INSERT INTO chats (id, created_at) VALUES ('old', 1)").run();
  migrateChat(db);
  migrateChat(db);
  const columns = (db.prepare("PRAGMA table_info(chats)").all() as { name: string }[]).map((c) => c.name);
  assert.ok(columns.includes("group_id"));
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM chats").get() as { n: number }).n, 1, "the old row is kept");
  db.exec("INSERT INTO groups (id) VALUES ('g1')");
  db.prepare("INSERT INTO chats (id, created_at, group_id) VALUES ('c1', 1, 'g1')").run();
  assert.throws(() => db.prepare("INSERT INTO chats (id, created_at, group_id) VALUES ('c2', 1, 'g1')").run(), /UNIQUE/, "one chat per group");
  db.close();
});

// ---------- the routes ----------

test("chat routes: members post and read in order, the sender is named, and the chat is made on first use", async () => {
  await withApp(async (app) => {
    const { alice, bob, group } = await flat(app);
    assert.equal((app.db.prepare("SELECT COUNT(*) AS n FROM chats").get() as { n: number }).n, 0, "no chat row until someone opens it");
    const empty = await ok(app, "GET", chatPath(group.id), { token: bob.token });
    assert.deepEqual(empty, { messages: [], muted: false });
    app.advance(1000);
    const first = await ok(app, "POST", chatPath(group.id), { token: alice.token, status: 201, body: { text: "  Hello all\r\n" } });
    assert.equal(first.message.body, "Hello all");
    assert.equal(first.message.userName, "Alice");
    assert.equal(first.message.userId, alice.id);
    await say(app, bob, group.id, "Hi Alice");
    const thread = await ok(app, "GET", chatPath(group.id), { token: alice.token });
    assert.deepEqual(thread.messages.map((m: any) => [m.userName, m.body]), [["Alice", "Hello all"], ["Bob", "Hi Alice"]]);
    assert.equal((app.db.prepare("SELECT COUNT(*) AS n FROM chats").get() as { n: number }).n, 1, "one chat for the group");
  });
});

test("chat routes: empty and too long are 400 with the kit reason, and nothing is stored", async () => {
  await withApp(async (app) => {
    const { alice, group } = await flat(app);
    for (const [text, reason] of [["   ", "empty"], [undefined, "empty"], [42, "empty"], ["x".repeat(1001), "too_long"]] as const) {
      const res = await say(app, alice, group.id, text as string);
      assert.equal(res.status, 400);
      assert.equal(res.json.reason, reason);
    }
    assert.equal((await say(app, alice, group.id, "x".repeat(1000))).status, 201, "1000 is allowed");
    assert.equal((await ok(app, "GET", chatPath(group.id), { token: alice.token })).messages.length, 1);
  });
});

test("chat routes: a non-member gets 404 on every route, the same as for a group that does not exist", async () => {
  await withApp(async (app) => {
    const { alice, group } = await flat(app);
    const mallory = await signUp(app, "Mallory");
    await say(app, alice, group.id, "private");
    const attempts: [string, string, unknown?][] = [
      ["GET", chatPath(group.id)],
      ["POST", chatPath(group.id), { text: "let me in" }],
      ["POST", chatPath(group.id, "/read"), {}],
      ["POST", chatPath(group.id, "/mute"), { muted: true }],
    ];
    for (const [method, path, body] of attempts) {
      const res = await api(app, method, path, { token: mallory.token, body });
      assert.equal(res.status, 404, `${method} ${path}`);
      const missing = await api(app, method, path.replace(group.id, "no-such-group"), { token: mallory.token, body });
      assert.deepEqual(res.json, missing.json, "same answer whether or not the group exists");
    }
    assert.equal((await ok(app, "GET", chatPath(group.id), { token: alice.token })).messages.length, 1, "nothing leaked in");
    assert.equal((await api(app, "GET", chatPath(group.id))).status, 401);
  });
});

test("chat routes: leaving the group closes the chat", async () => {
  await withApp(async (app) => {
    const { bob, group } = await flat(app);
    await ok(app, "POST", `/api/groups/${group.id}/leave`, { token: bob.token });
    assert.equal((await api(app, "GET", chatPath(group.id), { token: bob.token })).status, 404);
  });
});

test("chat routes: mute is stored per person, shows in the thread, and needs a boolean", async () => {
  await withApp(async (app) => {
    const { alice, bob, group } = await flat(app);
    assert.deepEqual(await ok(app, "POST", chatPath(group.id, "/mute"), { token: bob.token, body: { muted: true } }), { muted: true });
    assert.equal((await ok(app, "GET", chatPath(group.id), { token: bob.token })).muted, true);
    assert.equal((await ok(app, "GET", chatPath(group.id), { token: alice.token })).muted, false);
    for (const body of [{}, { muted: "yes" }, { muted: 1 }]) {
      assert.equal((await api(app, "POST", chatPath(group.id, "/mute"), { token: bob.token, body })).status, 400);
    }
    await ok(app, "POST", chatPath(group.id, "/mute"), { token: bob.token, body: { muted: false } });
    assert.equal((await ok(app, "GET", chatPath(group.id), { token: bob.token })).muted, false);
  });
});

// ---------- unread ----------

test("unread: GET /api/groups and GET /api/groups/:id carry unreadChat, and opening or marking read clears it", async () => {
  await withApp(async (app) => {
    const { alice, bob, group } = await flat(app);
    const unread = async (who: Person) => (await ok(app, "GET", "/api/groups", { token: who.token })).groups[0].unreadChat;
    assert.equal(await unread(bob), 0, "a group with no chat yet reads 0");
    app.advance(1000);
    await say(app, alice, group.id, "one");
    await say(app, alice, group.id, "two");
    await say(app, bob, group.id, "mine");
    assert.equal(await unread(bob), 2);
    assert.equal(await unread(alice), 1, "Bob's message is Alice's only unread one");
    assert.equal((await ok(app, "GET", `/api/groups/${group.id}`, { token: bob.token })).group.unreadChat, 2);
    // The poller's markRead hook.
    app.advance(1000);
    await ok(app, "POST", chatPath(group.id, "/read"), { token: bob.token, body: {} });
    assert.equal(await unread(bob), 0);
    assert.equal(await unread(alice), 1, "Bob reading does not touch Alice");
    app.advance(1000);
    await say(app, alice, group.id, "three");
    assert.equal(await unread(bob), 1);
    // Opening the thread marks it read.
    app.advance(1000);
    await ok(app, "GET", chatPath(group.id), { token: bob.token });
    assert.equal(await unread(bob), 0);
  });
});

test("unread: counts are per group, and a person only sees their own groups", async () => {
  await withApp(async (app) => {
    const alice = await signUp(app, "Alice");
    const bob = await signUp(app, "Bob");
    const flatG = await makeGroup(app, alice, "Flat");
    const club = await makeGroup(app, alice, "Club");
    await joinWith(app, bob, flatG.inviteCode);
    await say(app, alice, club.id, "club only");
    await say(app, alice, flatG.id, "flat only");
    const groups = (await ok(app, "GET", "/api/groups", { token: bob.token })).groups;
    assert.deepEqual(groups.map((g: any) => [g.name, g.unreadChat]), [["Flat", 1]]);
  });
});

// ---------- push ----------

async function subscribed(app: AppCtx, ...people: Person[]) {
  for (const who of people) await ok(app, "POST", "/api/push/subscribe", { token: who.token, body: sub(who.name.toLowerCase()) });
}

test("push: a chat message goes to the other members, titled with the group name, with no message text and the chat url", async () => {
  await withApp(async (app) => {
    const { alice, bob, group } = await flat(app);
    const cara = await signUp(app, "Cara");
    await joinWith(app, cara, group.inviteCode);
    await subscribed(app, alice, bob, cara);
    await say(app, alice, group.id, "the wifi password is hunter2");
    assert.equal(app.sent.length, 0, "held back until the window passes");
    await app.chat.flush(true);
    assert.deepEqual(app.sent.map((s) => s.endpoint).sort(), [sub("bob").endpoint, sub("cara").endpoint], "not the sender");
    for (const { payload } of app.sent) {
      assert.equal(payload.title, "Flat");
      assert.equal(payload.body, "New message");
      assert.equal(payload.url, `/#/group/${group.id}/chat`);
      assert.ok(!JSON.stringify(payload).includes("hunter2"), "the text is not in the push");
    }
  }, { env: VAPID });
});

test("push: several messages become one push with a count, and it still holds no text", async () => {
  await withApp(async (app) => {
    const { alice, bob, group } = await flat(app);
    await subscribed(app, bob);
    for (const text of ["secret one", "secret two", "secret three"]) await say(app, alice, group.id, text);
    assert.equal(app.chat.pending(), 1);
    await app.chat.flush(true);
    assert.equal(app.sent.length, 1);
    assert.equal(app.sent[0].payload.body, "3 new messages");
    assert.ok(!/secret/.test(JSON.stringify(app.sent[0].payload)));
  }, { env: VAPID });
});

test("push: a muted member gets nothing, and muting after the message is queued drops it too", async () => {
  await withApp(async (app) => {
    const { alice, bob, group } = await flat(app);
    const cara = await signUp(app, "Cara");
    await joinWith(app, cara, group.inviteCode);
    await subscribed(app, bob, cara);
    await ok(app, "POST", chatPath(group.id, "/mute"), { token: bob.token, body: { muted: true } });
    await say(app, alice, group.id, "hello");
    assert.equal(app.chat.pending(), 1, "only Cara is queued");
    await ok(app, "POST", chatPath(group.id, "/mute"), { token: cara.token, body: { muted: true } });
    await app.chat.flush(true);
    assert.deepEqual(app.sent, [], "Bob was muted before, Cara muted while it was queued");
    assert.equal(app.chat.pending(), 0);
  }, { env: VAPID });
});

test("push: someone who left the group before the push fires gets nothing", async () => {
  await withApp(async (app) => {
    const { alice, bob, group } = await flat(app);
    await subscribed(app, bob);
    await say(app, alice, group.id, "hello");
    await ok(app, "POST", `/api/groups/${group.id}/leave`, { token: bob.token });
    await app.chat.flush(true);
    assert.deepEqual(app.sent, []);
  }, { env: VAPID });
});

test("push: nothing is sent without VAPID keys, and a gone subscription is removed", async () => {
  await withApp(async (app) => {
    const { alice, bob, group } = await flat(app);
    await subscribed(app, bob);
    await say(app, alice, group.id, "hello");
    await app.chat.flush(true);
    assert.deepEqual(app.sent, [], "no VAPID, no push");
  });
  let calls = 0;
  await withApp(async (app) => {
    const { alice, bob, group } = await flat(app);
    await subscribed(app, bob);
    await say(app, alice, group.id, "hello");
    await app.chat.flush(true);
    assert.equal(calls, 1);
    assert.equal((app.db.prepare("SELECT COUNT(*) AS n FROM push_subscriptions").get() as { n: number }).n, 0, "410 removes it");
  }, { env: VAPID, push: { async send() { calls += 1; throw Object.assign(new Error("gone"), { statusCode: 410 }); } } });
});

test("push: close() sends what is queued, then stops, so the shutdown path loses nothing", async () => {
  await withApp(async (app) => {
    const { alice, bob, group } = await flat(app);
    await subscribed(app, bob);
    await say(app, alice, group.id, "hello");
    assert.equal(app.sent.length, 0);
    await app.chat.close();
    assert.equal(app.sent.length, 1);
    assert.equal(app.chat.pending(), 0);
  }, { env: VAPID });
});

test("push: the line is generic for any count", () => {
  assert.equal(pushLine(1), "New message");
  assert.equal(pushLine(2), "2 new messages");
});
