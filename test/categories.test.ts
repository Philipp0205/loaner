import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { CATEGORIES } from "../src/categories.js";
import { openDb } from "../src/db.js";
import { api, makeGroup, makeItem, ok, signUp, withApp } from "./http.js";

test("categories: the server list and the public list match exactly", async () => {
  const { CATEGORIES: publicList } = (await import(new URL("../public/categories.js", import.meta.url).href)) as { CATEGORIES: string[] };
  assert.deepEqual([...CATEGORIES], publicList);
  assert.equal(publicList.join(","), "Tools,Kitchen,Camping,Sports,Garden,Electronics,Kids,Household,Other");
});

test("items: create with a category and read it back", async () => {
  await withApp(async (app) => {
    const alice = await signUp(app, "Alice");
    const flat = await makeGroup(app, alice, "Flat");
    const id = await makeItem(app, alice, [flat.id], { category: "Tools" });
    assert.equal((await ok(app, "GET", `/api/items/${id}`, { token: alice.token })).item.category, "Tools");
    const mine = (await ok(app, "GET", "/api/items/mine", { token: alice.token })).items;
    assert.equal(mine[0].category, "Tools");
    const group = (await ok(app, "GET", `/api/groups/${flat.id}/items`, { token: alice.token })).items;
    assert.equal(group[0].category, "Tools");
  });
});

test("items: an unknown category is a 400, on create and on patch", async () => {
  await withApp(async (app) => {
    const alice = await signUp(app, "Alice");
    const flat = await makeGroup(app, alice, "Flat");
    const post = (category: unknown) => api(app, "POST", "/api/items", { token: alice.token, body: { name: "Drill", groupIds: [flat.id], category } });
    for (const bad of ["Gadgets", "tools", 5, true, ["Tools"]]) assert.equal((await post(bad)).status, 400, JSON.stringify(bad));
    const id = await makeItem(app, alice, [flat.id], { category: "Kitchen" });
    const patch = (category: unknown) => api(app, "PATCH", `/api/items/${id}`, { token: alice.token, body: { category } });
    assert.equal((await patch("Nope")).status, 400);
    assert.equal((await ok(app, "GET", `/api/items/${id}`, { token: alice.token })).item.category, "Kitchen", "a rejected patch changes nothing");
  });
});

test("items: leaving the category out stores null, on create and on patch", async () => {
  await withApp(async (app) => {
    const alice = await signUp(app, "Alice");
    const flat = await makeGroup(app, alice, "Flat");
    const plain = await makeItem(app, alice, [flat.id]);
    assert.equal((await ok(app, "GET", `/api/items/${plain}`, { token: alice.token })).item.category, null);
    const id = await makeItem(app, alice, [flat.id], { category: "Camping" });
    await ok(app, "PATCH", `/api/items/${id}`, { token: alice.token, body: { name: "Tent" } });
    assert.equal((await ok(app, "GET", `/api/items/${id}`, { token: alice.token })).item.category, "Camping", "omitted on patch keeps the value");
  });
});

test("items: patch changes or clears the category", async () => {
  await withApp(async (app) => {
    const alice = await signUp(app, "Alice");
    const flat = await makeGroup(app, alice, "Flat");
    const id = await makeItem(app, alice, [flat.id], { category: "Tools" });
    const read = async () => (await ok(app, "GET", `/api/items/${id}`, { token: alice.token })).item.category;
    await ok(app, "PATCH", `/api/items/${id}`, { token: alice.token, body: { category: "Garden" } });
    assert.equal(await read(), "Garden");
    await ok(app, "PATCH", `/api/items/${id}`, { token: alice.token, body: { category: null } });
    assert.equal(await read(), null);
    await ok(app, "PATCH", `/api/items/${id}`, { token: alice.token, body: { category: "Kids" } });
    await ok(app, "PATCH", `/api/items/${id}`, { token: alice.token, body: { category: "" } });
    assert.equal(await read(), null, "an empty string clears it");
  });
});

test("db: an existing items table without a category column is upgraded", () => {
  const file = path.join(os.tmpdir(), `loaner-migrate-${process.pid}-${Date.now()}.sqlite`);
  try {
    const old = new DatabaseSync(file);
    old.exec("CREATE TABLE items (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', available INTEGER NOT NULL DEFAULT 1, donation_cents INTEGER, photo BLOB, photo_type TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
    old.exec("INSERT INTO items (id, owner_id, name, created_at, updated_at) VALUES ('a', 'u', 'Old drill', 1, 1)");
    old.close();
    for (let pass = 0; pass < 2; pass += 1) {
      const db = openDb(file);
      const cols = (db.prepare("PRAGMA table_info(items)").all() as unknown as { name: string }[]).filter((c) => c.name === "category");
      assert.equal(cols.length, 1, "exactly one category column, even after reopening");
      assert.equal((db.prepare("SELECT category FROM items WHERE id = 'a'").get() as { category: string | null }).category, null);
      db.close();
    }
  } finally {
    for (const suffix of ["", "-wal", "-shm"]) {
      try { fs.rmSync(file + suffix); } catch { /* not there */ }
    }
  }
});
