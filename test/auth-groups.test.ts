import assert from "node:assert/strict";
import test from "node:test";
import { api, joinWith, makeGroup, ok, signUp, withApp } from "./http.js";

test("auth: start returns a token and recovery code, only hashes are stored", async () => {
  await withApp(async (app) => {
    const alice = await signUp(app, "Alice");
    assert.match(alice.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const me = await ok(app, "GET", "/api/me", { token: alice.token });
    assert.equal(me.user.name, "Alice");
    assert.equal(me.unread, 0);
    const stored = JSON.stringify(app.db.prepare("SELECT * FROM devices").all()) + JSON.stringify(app.db.prepare("SELECT * FROM users").all());
    assert.ok(!stored.includes(alice.token), "device token is not stored in clear");
    assert.ok(!stored.includes(alice.code), "recovery code is not stored in clear");
  });
});

test("auth: name must be 1 to 24 characters", async () => {
  await withApp(async (app) => {
    for (const name of ["", "   ", "x".repeat(25), 5, null]) {
      const res = await api(app, "POST", "/api/auth/start", { body: { name } });
      assert.equal(res.status, 400, `name ${JSON.stringify(name)}`);
    }
    assert.equal((await api(app, "POST", "/api/auth/start", { body: { name: "x".repeat(24) } })).status, 200);
  });
});

test("auth: recover issues a new token, a typed-in code works, old token keeps working", async () => {
  await withApp(async (app) => {
    const alice = await signUp(app, "Alice");
    const typed = alice.code.toLowerCase().replace(/-/g, " ");
    const res = await ok(app, "POST", "/api/auth/recover", { body: { code: typed } });
    assert.notEqual(res.token, alice.token);
    assert.equal(res.user.id, alice.id);
    assert.equal((await ok(app, "GET", "/api/me", { token: res.token })).user.id, alice.id);
    assert.equal((await api(app, "GET", "/api/me", { token: alice.token })).status, 200);
  });
});

test("auth: wrong recovery code and bad tokens are rejected", async () => {
  await withApp(async (app) => {
    await signUp(app, "Alice");
    assert.equal((await api(app, "POST", "/api/auth/recover", { body: { code: "AAAA-BBBB-CCCC" } })).status, 401);
    assert.equal((await api(app, "POST", "/api/auth/recover", { body: { code: "nope" } })).status, 401);
    assert.equal((await api(app, "GET", "/api/me")).status, 401);
    assert.equal((await api(app, "GET", "/api/me", { token: "not-a-token" })).status, 401);
    assert.equal((await api(app, "GET", "/api/groups", { token: "not-a-token" })).status, 401);
  });
});

test("auth: recovery attempts are rate limited", async () => {
  await withApp(async (app) => {
    let last = 0;
    for (let i = 0; i < 12; i += 1) last = (await api(app, "POST", "/api/auth/recover", { body: { code: "AAAA-BBBB-CCCC" } })).status;
    assert.equal(last, 429);
  });
});

test("auth: a new recovery code replaces the old one", async () => {
  await withApp(async (app) => {
    const alice = await signUp(app, "Alice");
    const fresh = await ok(app, "POST", "/api/me/recovery-code", { token: alice.token });
    assert.notEqual(fresh.recoveryCode, alice.code);
    assert.equal((await api(app, "POST", "/api/auth/recover", { body: { code: alice.code } })).status, 401);
    assert.equal((await api(app, "POST", "/api/auth/recover", { body: { code: fresh.recoveryCode } })).status, 200);
  });
});

test("groups: create, invite lookup, join, several groups, member list", async () => {
  await withApp(async (app) => {
    const alice = await signUp(app, "Alice");
    const bob = await signUp(app, "Bob");
    const flat = await makeGroup(app, alice, "Flat 3B");
    const club = await makeGroup(app, alice, "Climbing club");
    assert.match(flat.inviteCode, /^[A-Z2-9]{10}$/);

    const preview = await ok(app, "GET", `/api/invites/${flat.inviteCode}`);
    assert.deepEqual(preview, { group: { name: "Flat 3B" } });

    await joinWith(app, bob, flat.inviteCode);
    await joinWith(app, bob, flat.inviteCode);
    await joinWith(app, bob, club.inviteCode.toLowerCase());
    const mine = await ok(app, "GET", "/api/groups", { token: bob.token });
    assert.deepEqual(mine.groups.map((g: any) => g.name), ["Flat 3B", "Climbing club"]);
    const detail = await ok(app, "GET", `/api/groups/${flat.id}`, { token: bob.token });
    assert.deepEqual(detail.group.members.map((m: any) => m.name), ["Alice", "Bob"]);
  });
});

test("groups: a bad invite code is a 404 and creates nothing", async () => {
  await withApp(async (app) => {
    const bob = await signUp(app, "Bob");
    assert.equal((await api(app, "GET", "/api/invites/NOPENOPE12")).status, 404);
    assert.equal((await api(app, "GET", "/api/invites/%25")).status, 404);
    assert.equal((await api(app, "POST", "/api/invites/NOPENOPE12/join", { token: bob.token })).status, 404);
    const before = (app.db.prepare("SELECT COUNT(*) AS n FROM users").get() as any).n;
    const res = await api(app, "POST", "/api/auth/start", { body: { name: "Carol", inviteCode: "NOPENOPE12" } });
    assert.equal(res.status, 404);
    assert.equal((app.db.prepare("SELECT COUNT(*) AS n FROM users").get() as any).n, before, "no half-made account");
  });
});

test("groups: a new user can sign up and join in one step", async () => {
  await withApp(async (app) => {
    const alice = await signUp(app, "Alice");
    const flat = await makeGroup(app, alice, "Flat 3B");
    const bob = await signUp(app, "Bob", flat.inviteCode);
    const mine = await ok(app, "GET", "/api/groups", { token: bob.token });
    assert.deepEqual(mine.groups.map((g: any) => g.name), ["Flat 3B"]);
  });
});

test("groups: non-members cannot read a group, its members or its items", async () => {
  await withApp(async (app) => {
    const alice = await signUp(app, "Alice");
    const mallory = await signUp(app, "Mallory");
    const flat = await makeGroup(app, alice, "Flat 3B");
    assert.equal((await api(app, "GET", `/api/groups/${flat.id}`, { token: mallory.token })).status, 404);
    assert.equal((await api(app, "GET", `/api/groups/${flat.id}/items`, { token: mallory.token })).status, 404);
    assert.equal((await api(app, "GET", `/api/groups/${flat.id}`)).status, 401);
    assert.deepEqual((await ok(app, "GET", "/api/groups", { token: mallory.token })).groups, []);
  });
});

test("groups: leaving removes your items from that group", async () => {
  await withApp(async (app) => {
    const alice = await signUp(app, "Alice");
    const bob = await signUp(app, "Bob");
    const flat = await makeGroup(app, alice, "Flat 3B");
    await joinWith(app, bob, flat.inviteCode);
    const item = (await ok(app, "POST", "/api/items", { token: bob.token, status: 201, body: { name: "Ladder", groupIds: [flat.id] } })).item.id;
    assert.equal((await api(app, "GET", `/api/items/${item}`, { token: alice.token })).status, 200);
    await ok(app, "POST", `/api/groups/${flat.id}/leave`, { token: bob.token });
    assert.equal((await api(app, "GET", `/api/items/${item}`, { token: alice.token })).status, 404);
    assert.equal((await api(app, "GET", `/api/groups/${flat.id}`, { token: bob.token })).status, 404);
  });
});
