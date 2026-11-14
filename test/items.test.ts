import assert from "node:assert/strict";
import test from "node:test";
import { api, joinWith, makeGroup, makeItem, ok, signUp, TINY_PNG, withApp } from "./http.js";

test("items: owner creates, edits, pauses and deletes", async () => {
  await withApp(async (app) => {
    const alice = await signUp(app, "Alice");
    const flat = await makeGroup(app, alice, "Flat");
    const id = await makeItem(app, alice, [flat.id], { donation: 5 });
    let got = (await ok(app, "GET", `/api/items/${id}`, { token: alice.token })).item;
    assert.equal(got.name, "Cordless drill");
    assert.equal(got.donation, 5);
    assert.equal(got.status, "available");
    assert.equal(got.mine, true);

    await ok(app, "PATCH", `/api/items/${id}`, { token: alice.token, body: { name: "Drill", note: "", donation: 2.5 } });
    got = (await ok(app, "GET", `/api/items/${id}`, { token: alice.token })).item;
    assert.deepEqual([got.name, got.note, got.donation], ["Drill", "", 2.5]);

    await ok(app, "PATCH", `/api/items/${id}`, { token: alice.token, body: { available: false } });
    assert.equal((await ok(app, "GET", `/api/items/${id}`, { token: alice.token })).item.status, "paused");
    await ok(app, "PATCH", `/api/items/${id}`, { token: alice.token, body: { donation: null, available: true } });
    got = (await ok(app, "GET", `/api/items/${id}`, { token: alice.token })).item;
    assert.deepEqual([got.status, got.donation], ["available", null]);

    await ok(app, "DELETE", `/api/items/${id}`, { token: alice.token });
    assert.equal((await api(app, "GET", `/api/items/${id}`, { token: alice.token })).status, 404);
  });
});

test("items: validation of name, note and groups", async () => {
  await withApp(async (app) => {
    const alice = await signUp(app, "Alice");
    const bob = await signUp(app, "Bob");
    const flat = await makeGroup(app, alice, "Flat");
    const other = await makeGroup(app, bob, "Bob's group");
    const post = (body: unknown) => api(app, "POST", "/api/items", { token: alice.token, body });
    assert.equal((await post({ name: "", groupIds: [flat.id] })).status, 400);
    assert.equal((await post({ name: "x".repeat(61), groupIds: [flat.id] })).status, 400);
    assert.equal((await post({ name: "Drill", note: "x".repeat(281), groupIds: [flat.id] })).status, 400);
    assert.equal((await post({ name: "Drill", groupIds: [] })).status, 400, "needs a group");
    assert.equal((await post({ name: "Drill" })).status, 400);
    assert.equal((await post({ name: "Drill", groupIds: [other.id] })).status, 400, "not your group");
    assert.equal((await post({ name: "Drill", groupIds: [flat.id] })).status, 201);
  });
});

test("items: donation must be a positive number with at most 2 decimals", async () => {
  await withApp(async (app) => {
    const alice = await signUp(app, "Alice");
    const flat = await makeGroup(app, alice, "Flat");
    const post = (donation: unknown) => api(app, "POST", "/api/items", { token: alice.token, body: { name: "Tent", groupIds: [flat.id], donation } });
    for (const bad of [0, -1, "5", "free", 1.234, 10_001, true]) {
      assert.equal((await post(bad)).status, 400, `donation ${JSON.stringify(bad)}`);
    }
    for (const good of [1, 5, 12.5, 0.99, 10_000]) assert.equal((await post(good)).status, 201, `donation ${good}`);
    const none = await post(null);
    assert.equal(none.status, 201);
    assert.equal(none.json.item.donation, null);
  });
});

test("items: only members of a group the item is shared with can see it", async () => {
  await withApp(async (app) => {
    const alice = await signUp(app, "Alice");
    const bob = await signUp(app, "Bob");
    const carol = await signUp(app, "Carol");
    const flat = await makeGroup(app, alice, "Flat");
    const club = await makeGroup(app, alice, "Club");
    await joinWith(app, bob, flat.inviteCode);
    await joinWith(app, carol, club.inviteCode);
    const drill = await makeItem(app, alice, [flat.id]);
    const tent = await makeItem(app, alice, [club.id], { name: "Tent" });
    const both = await makeItem(app, alice, [flat.id, club.id], { name: "Games" });

    const names = async (who: typeof alice, group: string) =>
      (await ok(app, "GET", `/api/groups/${group}/items`, { token: who.token })).items.map((i: any) => i.name).sort();
    assert.deepEqual(await names(bob, flat.id), ["Cordless drill", "Games"]);
    assert.deepEqual(await names(carol, club.id), ["Games", "Tent"]);
    assert.deepEqual(await names(alice, club.id), ["Games", "Tent"]);

    assert.equal((await api(app, "GET", `/api/items/${drill}`, { token: bob.token })).status, 200);
    assert.equal((await api(app, "GET", `/api/items/${tent}`, { token: bob.token })).status, 404, "tent is only in the club");
    assert.equal((await api(app, "GET", `/api/items/${drill}`, { token: carol.token })).status, 404);
    assert.equal((await api(app, "GET", `/api/items/${both}`, { token: carol.token })).status, 200);
    // Bob does not learn about the club through the group list of the item.
    assert.deepEqual((await ok(app, "GET", `/api/items/${both}`, { token: bob.token })).item.groupIds, [flat.id]);
    assert.deepEqual((await ok(app, "GET", `/api/items/${both}`, { token: alice.token })).item.groupIds.sort(), [flat.id, club.id].sort());

    // Editing the sharing moves visibility.
    await ok(app, "PATCH", `/api/items/${drill}`, { token: alice.token, body: { groupIds: [club.id] } });
    assert.equal((await api(app, "GET", `/api/items/${drill}`, { token: bob.token })).status, 404);
    assert.equal((await api(app, "GET", `/api/items/${drill}`, { token: carol.token })).status, 200);
  });
});

test("items: only the owner edits, pauses, deletes or changes the photo", async () => {
  await withApp(async (app) => {
    const alice = await signUp(app, "Alice");
    const bob = await signUp(app, "Bob");
    const flat = await makeGroup(app, alice, "Flat");
    await joinWith(app, bob, flat.inviteCode);
    const id = await makeItem(app, alice, [flat.id]);
    assert.equal((await api(app, "PATCH", `/api/items/${id}`, { token: bob.token, body: { name: "Mine now" } })).status, 403);
    assert.equal((await api(app, "PATCH", `/api/items/${id}`, { token: bob.token, body: { available: false } })).status, 403);
    assert.equal((await api(app, "DELETE", `/api/items/${id}`, { token: bob.token })).status, 403);
    assert.equal((await api(app, "PUT", `/api/items/${id}/photo`, { token: bob.token, raw: TINY_PNG, contentType: "image/png" })).status, 403);
    assert.equal((await ok(app, "GET", `/api/items/${id}`, { token: alice.token })).item.name, "Cordless drill");
  });
});

test("photo: upload, serve with auth, validate type, content and size", async () => {
  await withApp(async (app) => {
    const alice = await signUp(app, "Alice");
    const bob = await signUp(app, "Bob");
    const mallory = await signUp(app, "Mallory");
    const flat = await makeGroup(app, alice, "Flat");
    await joinWith(app, bob, flat.inviteCode);
    const id = await makeItem(app, alice, [flat.id]);
    assert.equal((await ok(app, "GET", `/api/items/${id}`, { token: alice.token })).item.hasPhoto, false);
    assert.equal((await api(app, "GET", `/api/items/${id}/photo`, { token: alice.token })).status, 404);

    const put = (raw: Buffer, contentType: string, token = alice.token) => api(app, "PUT", `/api/items/${id}/photo`, { token, raw, contentType });
    assert.equal((await put(TINY_PNG, "image/gif")).status, 415, "type not allowed");
    assert.equal((await put(TINY_PNG, "text/html")).status, 415);
    assert.equal((await put(Buffer.from("<script>alert(1)</script>"), "image/png")).status, 415, "bytes are not a png");
    assert.equal((await put(TINY_PNG, "image/jpeg")).status, 415, "header and bytes disagree");
    assert.equal((await put(Buffer.alloc(0), "image/png")).status, 400);
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(2 * 1024 * 1024)]);
    assert.equal((await put(big, "image/jpeg")).status, 413, "over 2 MB");
    const almost = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(2 * 1024 * 1024 - 3)]);
    assert.equal((await put(almost, "image/jpeg")).status, 200, "exactly 2 MB is fine");
    assert.equal((await put(TINY_PNG, "image/png")).status, 200);
    assert.equal((await put(TINY_PNG, "image/png", bob.token)).status, 403, "not the owner");

    const photo = await api(app, "GET", `/api/items/${id}/photo`, { token: bob.token });
    assert.equal(photo.status, 200);
    assert.equal(photo.type, "image/png");
    assert.ok(photo.bytes.equals(TINY_PNG));
    assert.equal((await ok(app, "GET", `/api/items/${id}`, { token: bob.token })).item.hasPhoto, true);

    assert.equal((await api(app, "GET", `/api/items/${id}/photo`)).status, 401, "no token");
    assert.equal((await api(app, "GET", `/api/items/${id}/photo`, { token: mallory.token })).status, 404, "not in the group");

    await ok(app, "DELETE", `/api/items/${id}/photo`, { token: alice.token });
    assert.equal((await api(app, "GET", `/api/items/${id}/photo`, { token: bob.token })).status, 404);
  });
});

test("items: the available-only filter hides lent and paused items", async () => {
  await withApp(async (app) => {
    const alice = await signUp(app, "Alice");
    const bob = await signUp(app, "Bob");
    const flat = await makeGroup(app, alice, "Flat");
    await joinWith(app, bob, flat.inviteCode);
    const free = await makeItem(app, alice, [flat.id], { name: "Free" });
    const paused = await makeItem(app, alice, [flat.id], { name: "Paused" });
    const lent = await makeItem(app, alice, [flat.id], { name: "Lent" });
    await ok(app, "PATCH", `/api/items/${paused}`, { token: alice.token, body: { available: false } });
    const req = await ok(app, "POST", `/api/items/${lent}/requests`, { token: bob.token, status: 201, body: { from: "2026-06-02", until: "2026-06-04" } });
    await ok(app, "POST", `/api/requests/${req.request.id}/approve`, { token: alice.token });
    await ok(app, "POST", `/api/requests/${req.request.id}/handover`, { token: alice.token });

    const all = (await ok(app, "GET", `/api/groups/${flat.id}/items`, { token: bob.token })).items;
    assert.deepEqual(all.map((i: any) => [i.name, i.status]).sort(), [["Free", "available"], ["Lent", "lent"], ["Paused", "paused"]]);
    assert.deepEqual(all.find((i: any) => i.name === "Lent").lent.to.name, "Bob");
    const only = (await ok(app, "GET", `/api/groups/${flat.id}/items?available=1`, { token: bob.token })).items;
    assert.deepEqual(only.map((i: any) => i.id), [free]);
  });
});
