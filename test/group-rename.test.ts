import assert from "node:assert/strict";
import test from "node:test";
import { api, joinWith, makeGroup, ok, signUp, withApp } from "./http.js";

test("rename: a member renames, another member and the invite preview see the new name", async () => {
  await withApp(async (app) => {
    const alice = await signUp(app, "Alice");
    const bob = await signUp(app, "Bob");
    const flat = await makeGroup(app, alice, "Flat 3B");
    await joinWith(app, bob, flat.inviteCode);

    const res = await ok(app, "PATCH", `/api/groups/${flat.id}`, { token: bob.token, body: { name: "Studio 4" } });
    assert.equal(res.group.id, flat.id);
    assert.equal(res.group.name, "Studio 4");
    assert.equal(res.group.inviteCode, flat.inviteCode);
    assert.deepEqual(res.group.members.map((m: any) => m.name), ["Alice", "Bob"]);

    const list = await ok(app, "GET", "/api/groups", { token: alice.token });
    assert.deepEqual(list.groups.map((g: any) => g.name), ["Studio 4"]);
    const detail = await ok(app, "GET", `/api/groups/${flat.id}`, { token: alice.token });
    assert.equal(detail.group.name, "Studio 4");
    assert.deepEqual(await ok(app, "GET", `/api/invites/${flat.inviteCode}`), { group: { name: "Studio 4" } });
  });
});

test("rename: the name is trimmed and whitespace is collapsed, like create", async () => {
  await withApp(async (app) => {
    const alice = await signUp(app, "Alice");
    const flat = await makeGroup(app, alice, "Flat 3B");
    const res = await ok(app, "PATCH", `/api/groups/${flat.id}`, { token: alice.token, body: { name: "  Studio \t  4  " } });
    assert.equal(res.group.name, "Studio 4");
    const created = await ok(app, "POST", "/api/groups", { token: alice.token, body: { name: "  Studio \t  4  " } });
    assert.equal(created.group.name, res.group.name);
  });
});

test("rename: empty, blank, missing and too-long names are 400, 40 characters is fine", async () => {
  await withApp(async (app) => {
    const alice = await signUp(app, "Alice");
    const flat = await makeGroup(app, alice, "Flat 3B");
    for (const body of [{ name: "" }, { name: "   " }, {}, { name: null }, { name: 5 }, { name: "x".repeat(41) }]) {
      const res = await api(app, "PATCH", `/api/groups/${flat.id}`, { token: alice.token, body });
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    assert.equal((await ok(app, "GET", `/api/groups/${flat.id}`, { token: alice.token })).group.name, "Flat 3B");
    const long = "y".repeat(40);
    assert.equal((await ok(app, "PATCH", `/api/groups/${flat.id}`, { token: alice.token, body: { name: long } })).group.name, long);
  });
});

test("rename: a non-member or an unknown id gets 404 and nothing changes, no token is 401", async () => {
  await withApp(async (app) => {
    const alice = await signUp(app, "Alice");
    const mallory = await signUp(app, "Mallory");
    const flat = await makeGroup(app, alice, "Flat 3B");
    assert.equal((await api(app, "PATCH", `/api/groups/${flat.id}`, { token: mallory.token, body: { name: "Hacked" } })).status, 404);
    assert.equal((await api(app, "PATCH", "/api/groups/no-such-group", { token: mallory.token, body: { name: "Hacked" } })).status, 404);
    // A bad name from a non-member is still 404, so nothing is learned about the group.
    assert.equal((await api(app, "PATCH", `/api/groups/${flat.id}`, { token: mallory.token, body: { name: "" } })).status, 404);
    assert.equal((await api(app, "PATCH", `/api/groups/${flat.id}`, { body: { name: "Hacked" } })).status, 401);
    assert.equal((await ok(app, "GET", `/api/groups/${flat.id}`, { token: alice.token })).group.name, "Flat 3B");
    assert.deepEqual(await ok(app, "GET", `/api/invites/${flat.inviteCode}`), { group: { name: "Flat 3B" } });
  });
});

test("rename: a member who left cannot rename", async () => {
  await withApp(async (app) => {
    const alice = await signUp(app, "Alice");
    const bob = await signUp(app, "Bob");
    const flat = await makeGroup(app, alice, "Flat 3B");
    await joinWith(app, bob, flat.inviteCode);
    await ok(app, "POST", `/api/groups/${flat.id}/leave`, { token: bob.token });
    assert.equal((await api(app, "PATCH", `/api/groups/${flat.id}`, { token: bob.token, body: { name: "Bob's now" } })).status, 404);
    assert.equal((await ok(app, "GET", `/api/groups/${flat.id}`, { token: alice.token })).group.name, "Flat 3B");
  });
});
