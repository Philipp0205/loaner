import assert from "node:assert/strict";
import test from "node:test";
import { api, joinWith, makeGroup, makeItem, ok, signUp, TINY_PNG, withApp } from "./http.js";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP")]);

async function setup(app: Parameters<Parameters<typeof withApp>[0]>[0]) {
  const owner = await signUp(app, "Olga");
  const friend = await signUp(app, "Fred");
  const outsider = await signUp(app, "Otto");
  const group = await makeGroup(app, owner, "Flat");
  await joinWith(app, friend, group.inviteCode);
  const id = await makeItem(app, owner, [group.id]);
  return { owner, friend, outsider, id };
}

const add = (app: { port: number }, token: string, id: string, raw = TINY_PNG, contentType = "image/png") =>
  api(app, "POST", `/api/items/${id}/photos`, { token, raw, contentType });

test("a new item has no photos", async () => {
  await withApp(async (app) => {
    const { owner, id } = await setup(app);
    const { item } = await ok(app, "GET", `/api/items/${id}`, { token: owner.token });
    assert.equal(item.hasPhoto, false);
    assert.deepEqual(item.photoIds, []);
    assert.deepEqual((await ok(app, "GET", `/api/items/${id}/photos`, { token: owner.token })).photoIds, []);
  });
});

test("the owner adds photos, they come back in order, and each one is served with its own type", async () => {
  await withApp(async (app) => {
    const { owner, friend, id } = await setup(app);
    const first = await add(app, owner.token, id);
    assert.equal(first.status, 201);
    const second = await add(app, owner.token, id, JPEG, "image/jpeg");
    const third = await add(app, owner.token, id, WEBP, "image/webp");
    assert.deepEqual(third.json.photoIds, [first.json.id, second.json.id, third.json.id]);

    const { item } = await ok(app, "GET", `/api/items/${id}`, { token: friend.token });
    assert.equal(item.hasPhoto, true);
    assert.deepEqual(item.photoIds, [first.json.id, second.json.id, third.json.id]);

    const one = await api(app, "GET", `/api/items/${id}/photos/${second.json.id}`, { token: friend.token });
    assert.equal(one.status, 200);
    assert.equal(one.type, "image/jpeg");
    assert.deepEqual(one.bytes, JPEG);
    const legacy = await api(app, "GET", `/api/items/${id}/photo`, { token: friend.token });
    assert.deepEqual(legacy.bytes, TINY_PNG, "the old route serves the first photo");
  });
});

test("an item takes at most 6 photos, the 7th is a 409, and removing one makes room", async () => {
  await withApp(async (app) => {
    const { owner, id } = await setup(app);
    const ids: string[] = [];
    for (let i = 0; i < 6; i += 1) ids.push((await add(app, owner.token, id)).json.id);
    const seventh = await add(app, owner.token, id);
    assert.equal(seventh.status, 409);
    assert.match(seventh.json.error, /at most 6 photos/);
    assert.equal((await ok(app, "GET", `/api/items/${id}/photos`, { token: owner.token })).photoIds.length, 6);
    await ok(app, "DELETE", `/api/items/${id}/photos/${ids[2]}`, { token: owner.token });
    assert.equal((await add(app, owner.token, id)).status, 201);
  });
});

test("photo uploads are checked: type header, bytes and size", async () => {
  await withApp(async (app) => {
    const { owner, id } = await setup(app);
    assert.equal((await add(app, owner.token, id, TINY_PNG, "text/plain")).status, 415);
    assert.equal((await add(app, owner.token, id, Buffer.from("not an image"), "image/png")).status, 415);
    assert.equal((await add(app, owner.token, id, TINY_PNG, "image/jpeg")).status, 415, "bytes must match the declared type");
    assert.equal((await add(app, owner.token, id, Buffer.alloc(0), "image/png")).status, 400);
    const big = Buffer.concat([TINY_PNG, Buffer.alloc(2 * 1024 * 1024)]);
    assert.equal((await add(app, owner.token, id, big, "image/png")).status, 413);
    assert.deepEqual((await ok(app, "GET", `/api/items/${id}/photos`, { token: owner.token })).photoIds, []);
  });
});

test("only the owner changes photos, and people outside the group cannot see them", async () => {
  await withApp(async (app) => {
    const { owner, friend, outsider, id } = await setup(app);
    const added = await add(app, owner.token, id);
    assert.equal((await add(app, friend.token, id)).status, 403);
    assert.equal((await api(app, "DELETE", `/api/items/${id}/photos/${added.json.id}`, { token: friend.token })).status, 403);
    assert.equal((await add(app, outsider.token, id)).status, 404);
    assert.equal((await api(app, "GET", `/api/items/${id}/photos`, { token: outsider.token })).status, 404);
    assert.equal((await api(app, "GET", `/api/items/${id}/photos/${added.json.id}`, { token: outsider.token })).status, 404);
    assert.equal((await api(app, "GET", `/api/items/${id}/photos/${added.json.id}`, {})).status, 401);
  });
});

test("a photo id from another item is a 404, and so is an unknown one", async () => {
  await withApp(async (app) => {
    const { owner, id } = await setup(app);
    const group = await makeGroup(app, owner, "Club");
    const other = await makeItem(app, owner, [group.id]);
    const added = await add(app, owner.token, other);
    assert.equal((await api(app, "GET", `/api/items/${id}/photos/${added.json.id}`, { token: owner.token })).status, 404);
    assert.equal((await api(app, "DELETE", `/api/items/${id}/photos/${added.json.id}`, { token: owner.token })).status, 404);
    assert.equal((await api(app, "GET", `/api/items/${id}/photos/nope`, { token: owner.token })).status, 404);
    assert.equal((await ok(app, "GET", `/api/items/${other}/photos`, { token: owner.token })).photoIds.length, 1, "the other item kept its photo");
  });
});

test("a photo change bumps the item's version, so cached copies refresh", async () => {
  await withApp(async (app) => {
    const { owner, id } = await setup(app);
    const before = (await ok(app, "GET", `/api/items/${id}`, { token: owner.token })).item.photoVersion;
    app.advance(1000);
    const added = await add(app, owner.token, id);
    const after = (await ok(app, "GET", `/api/items/${id}`, { token: owner.token })).item.photoVersion;
    assert.ok(after > before);
    app.advance(1000);
    await ok(app, "DELETE", `/api/items/${id}/photos/${added.json.id}`, { token: owner.token });
    assert.ok((await ok(app, "GET", `/api/items/${id}`, { token: owner.token })).item.photoVersion > after);
  });
});

test("the older single photo routes keep working on the first photo", async () => {
  await withApp(async (app) => {
    const { owner, id } = await setup(app);
    assert.equal((await api(app, "GET", `/api/items/${id}/photo`, { token: owner.token })).status, 404);
    await ok(app, "PUT", `/api/items/${id}/photo`, { token: owner.token, raw: TINY_PNG, contentType: "image/png" });
    let { item } = await ok(app, "GET", `/api/items/${id}`, { token: owner.token });
    assert.equal(item.photoIds.length, 1);
    const firstId = item.photoIds[0];

    await add(app, owner.token, id, JPEG, "image/jpeg");
    await ok(app, "PUT", `/api/items/${id}/photo`, { token: owner.token, raw: WEBP, contentType: "image/webp" });
    ({ item } = await ok(app, "GET", `/api/items/${id}`, { token: owner.token }));
    assert.equal(item.photoIds.length, 2, "PUT replaces the first photo, it does not add one");
    assert.equal(item.photoIds[0], firstId);
    const first = await api(app, "GET", `/api/items/${id}/photo`, { token: owner.token });
    assert.equal(first.type, "image/webp");

    assert.equal((await api(app, "PUT", `/api/items/${id}/photo`, { token: owner.token, raw: Buffer.from("x"), contentType: "image/png" })).status, 415);
    await ok(app, "DELETE", `/api/items/${id}/photo`, { token: owner.token });
    ({ item } = await ok(app, "GET", `/api/items/${id}`, { token: owner.token }));
    assert.equal(item.photoIds.length, 1, "DELETE removes only the first photo");
    assert.equal((await api(app, "GET", `/api/items/${id}/photo`, { token: owner.token })).type, "image/jpeg");
    await ok(app, "DELETE", `/api/items/${id}/photo`, { token: owner.token });
    assert.equal((await ok(app, "GET", `/api/items/${id}`, { token: owner.token })).item.hasPhoto, false);
  });
});

test("deleting an item deletes its photos", async () => {
  await withApp(async (app) => {
    const { owner, id } = await setup(app);
    await add(app, owner.token, id);
    await add(app, owner.token, id);
    await ok(app, "DELETE", `/api/items/${id}`, { token: owner.token });
    const left = app.db.prepare("SELECT COUNT(*) AS n FROM item_photos").get() as { n: number };
    assert.equal(left.n, 0);
  });
});

test("lists carry the photo ids, and request cards still show a photo", async () => {
  await withApp(async (app) => {
    const { owner, friend, id } = await setup(app);
    const added = await add(app, owner.token, id);
    const group = (await ok(app, "GET", "/api/groups", { token: friend.token })).groups[0];
    const { items } = await ok(app, "GET", `/api/groups/${group.id}/items`, { token: friend.token });
    assert.deepEqual(items[0].photoIds, [added.json.id]);
    const mine = await ok(app, "GET", "/api/items/mine", { token: owner.token });
    assert.equal(mine.items[0].hasPhoto, true);
    const day = (offset: number) => new Date(Date.parse("2026-06-01T00:00:00Z") + offset * 86_400_000).toISOString().slice(0, 10);
    await ok(app, "POST", `/api/items/${id}/requests`, { token: friend.token, status: 201, body: { from: day(1), until: day(2), message: "Please" } });
    const { requests } = await ok(app, "GET", "/api/requests?role=outgoing", { token: friend.token });
    assert.equal(requests[0].item.hasPhoto, true);
  });
});
