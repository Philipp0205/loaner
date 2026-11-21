import assert from "node:assert/strict";
import test from "node:test";
import { previewText, sortChats, type ChatRow } from "../src/chat/list.js";
import { api, joinWith, makeGroup, ok, signUp, withApp, type AppCtx, type Person } from "./http.js";

const say = (app: AppCtx, who: Person, group: string, text: string) => api(app, "POST", `/api/groups/${group}/chat`, { token: who.token, body: { text } });
const chats = async (app: AppCtx, who: Person) => (await ok(app, "GET", "/api/chats", { token: who.token })).chats as any[];

test("chat list: a member with no messages sees each group with no preview and nothing unread", async () => {
  await withApp(async (app) => {
    const alice = await signUp(app, "Alice");
    await makeGroup(app, alice, "Flat");
    const rows = await chats(app, alice);
    assert.deepEqual(rows.map((r) => [r.name, r.unreadChat, r.last]), [["Flat", 0, null]]);
  });
});

test("chat list: no groups gives an empty list, and signing in is required", async () => {
  await withApp(async (app) => {
    const alice = await signUp(app, "Alice");
    assert.deepEqual(await chats(app, alice), []);
    assert.equal((await api(app, "GET", "/api/chats")).status, 401);
  });
});

test("chat list: the preview is the newest message with its author, and unread skips my own", async () => {
  await withApp(async (app) => {
    const alice = await signUp(app, "Alice");
    const bob = await signUp(app, "Bob");
    const group = await makeGroup(app, alice, "Flat");
    await joinWith(app, bob, group.inviteCode);
    app.advance(1000);
    await say(app, alice, group.id, "first");
    app.advance(1000);
    await say(app, alice, group.id, "  second\n\nline  ");
    app.advance(1000);
    await say(app, bob, group.id, "newest from Bob");
    const [forAlice] = await chats(app, alice);
    assert.equal(forAlice.last.author, "Bob");
    assert.equal(forAlice.last.userId, bob.id);
    assert.equal(forAlice.last.text, "newest from Bob");
    assert.equal(forAlice.unreadChat, 1);
    const [forBob] = await chats(app, bob);
    assert.equal(forBob.unreadChat, 2, "Alice's two messages");
    app.advance(1000);
    await say(app, alice, group.id, "  second\n\nline  ");
    assert.equal((await chats(app, bob))[0].last.text, "second line", "whitespace is collapsed to one line");
    app.advance(1000);
    await ok(app, "GET", `/api/groups/${group.id}/chat`, { token: bob.token });
    assert.equal((await chats(app, bob))[0].unreadChat, 0, "opening the chat clears it");
  });
});

test("chat list: only my groups appear, and another group's text never leaks", async () => {
  await withApp(async (app) => {
    const alice = await signUp(app, "Alice");
    const bob = await signUp(app, "Bob");
    const flat = await makeGroup(app, alice, "Flat");
    const club = await makeGroup(app, alice, "Club");
    await joinWith(app, bob, flat.inviteCode);
    await say(app, alice, club.id, "club secret");
    await say(app, alice, flat.id, "flat hello");
    const rows = await chats(app, bob);
    assert.deepEqual(rows.map((r) => r.name), ["Flat"]);
    assert.ok(!JSON.stringify(rows).includes("club secret"));
    await ok(app, "POST", `/api/groups/${flat.id}/leave`, { token: bob.token });
    assert.deepEqual(await chats(app, bob), [], "a person who left sees nothing");
  });
});

test("chat list: groups sort by newest message, then groups with no messages by name", async () => {
  await withApp(async (app) => {
    const alice = await signUp(app, "Alice");
    const zoo = await makeGroup(app, alice, "Zoo");
    const flat = await makeGroup(app, alice, "Flat");
    await makeGroup(app, alice, "Attic");
    app.advance(1000);
    await say(app, alice, zoo.id, "older");
    app.advance(1000);
    await say(app, alice, flat.id, "newer");
    assert.deepEqual((await chats(app, alice)).map((r) => r.name), ["Flat", "Zoo", "Attic"]);
  });
});

test("chat list: a long message is cut to a short preview", () => {
  assert.equal(previewText("  a \n b  "), "a b");
  const cut = previewText("x".repeat(500));
  assert.ok(cut.length <= 120 && cut.endsWith("..."));
  assert.ok(!cut.includes("\u2014"));
});

test("chat list: sortChats puts messaged groups first by time and breaks ties by name", () => {
  const row = (name: string, at: number | null): ChatRow => ({ id: name, name, unreadChat: 0, last: at === null ? null : { userId: "u", author: "A", text: "t", at } });
  const sorted = sortChats([row("b", null), row("a", null), row("old", 1), row("new", 5), row("tie-b", 3), row("tie-a", 3)]);
  assert.deepEqual(sorted.map((r) => r.name), ["new", "tie-a", "tie-b", "old", "a", "b"]);
});

test("chat list: the push text still holds no message text", async () => {
  await withApp(async (app) => {
    const alice = await signUp(app, "Alice");
    const bob = await signUp(app, "Bob");
    const group = await makeGroup(app, alice, "Flat");
    await joinWith(app, bob, group.inviteCode);
    await ok(app, "POST", "/api/push/subscribe", { token: bob.token, body: { endpoint: "https://push.example.test/bob", keys: { p256dh: "p", auth: "a" } } });
    await say(app, alice, group.id, "the wifi password is hunter2");
    await app.chat.flush(true);
    assert.ok(!JSON.stringify(app.sent).includes("hunter2"));
  }, { env: { VAPID_PUBLIC_KEY: "pub-key-for-tests", VAPID_PRIVATE_KEY: "priv-key-for-tests" } });
});
