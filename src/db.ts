import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  recovery_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS memberships_user ON memberships(user_id);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  available INTEGER NOT NULL DEFAULT 1,
  donation_cents INTEGER,
  photo BLOB,
  photo_type TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS items_owner ON items(owner_id);

CREATE TABLE IF NOT EXISTS item_groups (
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, group_id)
);
CREATE INDEX IF NOT EXISTS item_groups_group ON item_groups(group_id);

-- status: pending, approved, declined, cancelled, lent, returned.
-- auto_declined marks a pending request that lost its dates to another approval.
CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  borrower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_date TEXT NOT NULL,
  until_date TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  reply TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  auto_declined INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  handed_over_at INTEGER,
  returned_at INTEGER,
  reminded INTEGER NOT NULL DEFAULT 0,
  nudged_on TEXT
);
CREATE INDEX IF NOT EXISTS requests_item ON requests(item_id, status);
CREATE INDEX IF NOT EXISTS requests_borrower ON requests(borrower_id);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  item_id TEXT,
  request_id TEXT,
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  borrower_id TEXT
);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, created_at);

-- One thread per (item, borrower). created_at is strictly increasing within a thread (see routes-messages.ts).
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  borrower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_thread ON messages(item_id, borrower_id, created_at, id);

-- last_read_at is the created_at of the newest message this person has seen in the thread.
CREATE TABLE IF NOT EXISTS message_reads (
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  borrower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at INTEGER NOT NULL,
  PRIMARY KEY (item_id, borrower_id, user_id)
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS push_user ON push_subscriptions(user_id);

-- In-app feedback. status: new, seen, done. display_name is the sender's name at send time.
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  display_name TEXT NOT NULL,
  text TEXT NOT NULL,
  app_version TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  photo BLOB,
  photo_type TEXT
);
CREATE INDEX IF NOT EXISTS feedback_created ON feedback(created_at);
`;

/** Opens (and creates) the database. ":memory:" for tests. */
export function openDb(file: string): DatabaseSync {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  if (file !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** CREATE TABLE IF NOT EXISTS never alters a table that already exists, so add newer columns here. */
function migrate(db: DatabaseSync): void {
  const columns = db.prepare("PRAGMA table_info(items)").all() as unknown as { name: string }[];
  if (!columns.some((column) => column.name === "category")) db.exec("ALTER TABLE items ADD COLUMN category TEXT");
  const noteColumns = db.prepare("PRAGMA table_info(notifications)").all() as unknown as { name: string }[];
  if (!noteColumns.some((column) => column.name === "borrower_id")) db.exec("ALTER TABLE notifications ADD COLUMN borrower_id TEXT");
}

/** Runs fn in one transaction. Rolls back and rethrows on error. Not reentrant. */
export function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

type Param = string | number | bigint | Uint8Array | null;

export function get<T>(db: DatabaseSync, sql: string, ...params: Param[]): T | undefined {
  return db.prepare(sql).get(...params) as unknown as T | undefined;
}

export function all<T>(db: DatabaseSync, sql: string, ...params: Param[]): T[] {
  return db.prepare(sql).all(...params) as unknown as T[];
}

export function run(db: DatabaseSync, sql: string, ...params: Param[]): number {
  return Number(db.prepare(sql).run(...params).changes);
}
