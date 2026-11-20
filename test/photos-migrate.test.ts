import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { openDb } from "../src/db.js";
import { TINY_PNG } from "./http.js";

// The migration moves the old single photo into item_photos once, and never brings it back.

const count = (db: DatabaseSync, sql: string, ...args: string[]): number => (db.prepare(sql).get(...args) as { n: number }).n;

function seedOld(file: string): void {
  const old = new DatabaseSync(file);
  old.exec("CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, recovery_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL)");
  old.exec("CREATE TABLE items (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', available INTEGER NOT NULL DEFAULT 1, donation_cents INTEGER, photo BLOB, photo_type TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
  old.prepare("INSERT INTO users (id, name, recovery_hash, created_at) VALUES ('u1', 'Olga', 'h', 1)").run();
  const insert = old.prepare("INSERT INTO items (id, owner_id, name, photo, photo_type, created_at, updated_at) VALUES (?, 'u1', ?, ?, ?, 1, 7)");
  insert.run("with-photo", "Drill", TINY_PNG, "image/png");
  insert.run("no-photo", "Tent", null, null);
  old.close();
}

function inTmp(fn: (file: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loaner-photos-"));
  try {
    fn(path.join(dir, "loaner.db"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("migration: an old single photo becomes the first photo and the old columns are cleared", () => {
  inTmp((file) => {
    seedOld(file);
    const db = openDb(file);
    const rows = db.prepare("SELECT item_id, position, photo_type, photo FROM item_photos").all() as { item_id: string; position: number; photo_type: string; photo: Uint8Array }[];
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].item_id, rows[0].position, rows[0].photo_type], ["with-photo", 0, "image/png"]);
    assert.deepEqual(Buffer.from(rows[0].photo), TINY_PNG);
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM items WHERE photo IS NOT NULL OR photo_type IS NOT NULL"), 0);
    db.close();
  });
});

test("migration: opening again changes nothing", () => {
  inTmp((file) => {
    seedOld(file);
    openDb(file).close();
    const db = openDb(file);
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM item_photos"), 1);
    db.close();
  });
});

test("migration: deleting every photo and reopening does not bring the old one back", () => {
  inTmp((file) => {
    seedOld(file);
    const first = openDb(file);
    first.exec("DELETE FROM item_photos");
    first.close();
    const db = openDb(file);
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM item_photos"), 0);
    db.close();
  });
});

test("migration: a leftover old blob next to new rows is cleared and the rows stay as they are", () => {
  inTmp((file) => {
    seedOld(file);
    const first = openDb(file);
    first.prepare("UPDATE items SET photo = ?, photo_type = 'image/png' WHERE id = 'with-photo'").run(TINY_PNG);
    first.close();
    const db = openDb(file);
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM item_photos WHERE item_id = ?", "with-photo"), 1);
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM items WHERE photo IS NOT NULL"), 0);
    db.close();
  });
});

test("migration: a brand new database starts with no photos and the donation_text column", () => {
  const db = openDb(":memory:");
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM item_photos"), 0);
  const columns = db.prepare("PRAGMA table_info(items)").all() as unknown as { name: string }[];
  assert.ok(columns.some((column) => column.name === "donation_text"));
  db.close();
});
