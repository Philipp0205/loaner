import assert from "node:assert/strict";
import test from "node:test";
import { api, joinWith, makeGroup, ok, signUp, withApp, type AppCtx } from "./http.js";

const SUB = { endpoint: "https://push.example.test/abc", keys: { p256dh: "p256-fake", auth: "auth-fake" } };

async function twoPeople(app: AppCtx) {
  const alice = await signUp(app, "Alice");
  const bob = await signUp(app, "Bob");
  const flat = await makeGroup(app, alice, "Flat 3B");
  await joinWith(app, bob, flat.inviteCode);
  return { alice, bob, flat };
}

const byName = (members: any[]) => Object.fromEntries(members.map((m) => [m.name, m.notificationsOn]));

test("members: list and detail carry id, name and notificationsOn, default false", async () => {
  await withApp(async (app) => {
    const { alice, bob, flat } = await twoPeople(app);
    const list = await ok(app, "GET", "/api/groups", { token: bob.token });
    const detail = await ok(app, "GET", `/api/groups/${flat.id}`, { token: alice.token });
    for (const members of [list.groups[0].members, detail.group.members]) {
      assert.deepEqual(members, [
        { id: alice.id, name: "Alice", notificationsOn: false },
        { id: bob.id, name: "Bob", notificationsOn: false },
      ]);
    }
  });
});

test("members: create, join and rename responses include notificationsOn", async () => {
  await withApp(async (app) => {
    const alice = await signUp(app, "Alice");
    const bob = await signUp(app, "Bob");
    await ok(app, "POST", "/api/push/subscribe", { token: alice.token, body: SUB });
    const created = await ok(app, "POST", "/api/groups", { token: alice.token, body: { name: "Flat" } });
    assert.deepEqual(created.group.members, [{ id: alice.id, name: "Alice", notificationsOn: true }]);
    const joined = await ok(app, "POST", `/api/invites/${created.group.inviteCode}/join`, { token: bob.token });
    assert.deepEqual(byName(joined.group.members), { Alice: true, Bob: false });
    const renamed = await ok(app, "PATCH", `/api/groups/${created.group.id}`, { token: bob.token, body: { name: "Studio" } });
    assert.deepEqual(byName(renamed.group.members), { Alice: true, Bob: false });
  });
});

test("members: subscribing turns one person on, a second subscription stays on, unsubscribing turns off", async () => {
  await withApp(async (app) => {
    const { alice, bob, flat } = await twoPeople(app);
    const read = async () => byName((await ok(app, "GET", `/api/groups/${flat.id}`, { token: bob.token })).group.members);

    await ok(app, "POST", "/api/push/subscribe", { token: alice.token, body: SUB });
    assert.deepEqual(await read(), { Alice: true, Bob: false });

    const second = { ...SUB, endpoint: "https://push.example.test/second" };
    await ok(app, "POST", "/api/push/subscribe", { token: alice.token, body: second });
    assert.deepEqual(await read(), { Alice: true, Bob: false });

    await ok(app, "POST", "/api/push/unsubscribe", { token: alice.token, body: { endpoint: SUB.endpoint } });
    assert.deepEqual(await read(), { Alice: true, Bob: false }, "one subscription is left");
    await ok(app, "POST", "/api/push/unsubscribe", { token: alice.token, body: { endpoint: second.endpoint } });
    assert.deepEqual(await read(), { Alice: false, Bob: false });
  });
});

test("members: the payload never carries subscription details", async () => {
  await withApp(async (app) => {
    const { alice, bob, flat } = await twoPeople(app);
    await ok(app, "POST", "/api/push/subscribe", { token: alice.token, body: SUB });
    await ok(app, "POST", "/api/push/subscribe", { token: bob.token, body: { ...SUB, endpoint: "https://push.example.test/bob" } });
    const responses = [
      await api(app, "GET", "/api/groups", { token: bob.token }),
      await api(app, "GET", `/api/groups/${flat.id}`, { token: bob.token }),
      await api(app, "PATCH", `/api/groups/${flat.id}`, { token: bob.token, body: { name: "Flat 3B" } }),
      await api(app, "POST", `/api/invites/${flat.inviteCode}/join`, { token: bob.token }),
    ];
    for (const res of responses) {
      assert.equal(res.status, 200);
      const raw = res.bytes.toString("utf8");
      for (const secret of ["endpoint", "p256dh", "auth", "keys", "push.example.test", "p256-fake", "auth-fake"]) {
        assert.ok(!raw.includes(secret), `${secret} must not appear`);
      }
    }
    const first = responses[1].json.group.members[0];
    assert.deepEqual(Object.keys(first).sort(), ["id", "name", "notificationsOn"]);
    assert.equal(typeof first.notificationsOn, "boolean");
  });
});

test("members: a non-member or unknown id gets 404 and learns nothing, no token is 401", async () => {
  await withApp(async (app) => {
    const { alice, flat } = await twoPeople(app);
    const mallory = await signUp(app, "Mallory");
    await ok(app, "POST", "/api/push/subscribe", { token: alice.token, body: SUB });

    const outsider = await api(app, "GET", `/api/groups/${flat.id}`, { token: mallory.token });
    const unknown = await api(app, "GET", "/api/groups/no-such-group", { token: mallory.token });
    assert.equal(outsider.status, 404);
    assert.equal(unknown.status, 404);
    assert.deepEqual(outsider.json, unknown.json, "same answer whether or not the group exists");
    assert.ok(!outsider.bytes.toString("utf8").includes("Alice"));
    assert.equal((await api(app, "GET", `/api/groups/${flat.id}`)).status, 401);
    assert.equal((await api(app, "GET", "/api/groups")).status, 401);

    assert.deepEqual((await ok(app, "GET", "/api/groups", { token: mallory.token })).groups, [], "the list only has your own groups");
  });
});

test("members: a member who left no longer sees the list", async () => {
  await withApp(async (app) => {
    const { bob, flat } = await twoPeople(app);
    await ok(app, "POST", `/api/groups/${flat.id}/leave`, { token: bob.token });
    assert.equal((await api(app, "GET", `/api/groups/${flat.id}`, { token: bob.token })).status, 404);
  });
});

test("members: the public invite preview is still only the group name", async () => {
  await withApp(async (app) => {
    const { alice, flat } = await twoPeople(app);
    await ok(app, "POST", "/api/push/subscribe", { token: alice.token, body: SUB });
    assert.deepEqual(await ok(app, "GET", `/api/invites/${flat.inviteCode}`), { group: { name: "Flat 3B" } });
  });
});
