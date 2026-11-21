import type { DatabaseSync } from "node:sqlite";
import { CHAT_SQLITE_SCHEMA } from "../app-kit/index.ts";

/** One chat per group. The chat id is the group id. Deleting the group deletes its chat. */
const CHATS_TABLE = `
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  group_id TEXT NOT NULL UNIQUE REFERENCES groups(id) ON DELETE CASCADE
);
`;

/** The kit's other suggested tables, with every user_id tied to users, so a removed account takes its chat rows along. */
const KIT_TABLES = CHAT_SQLITE_SCHEMA.replaceAll("user_id TEXT NOT NULL,", "user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,");

/**
 * Creates the chat tables. Safe to run on every start. CREATE TABLE IF NOT EXISTS never alters a table that
 * exists, so a chats table made from the plain kit schema (no group_id) gets the column added here, the same
 * way db.ts adds item columns. SQLite cannot add a UNIQUE column, so that case gets a unique index instead.
 */
export function migrateChat(db: DatabaseSync): void {
  db.exec(CHATS_TABLE);
  db.exec(KIT_TABLES);
  const columns = db.prepare("PRAGMA table_info(chats)").all() as unknown as { name: string }[];
  if (!columns.some((column) => column.name === "group_id")) {
    db.exec("ALTER TABLE chats ADD COLUMN group_id TEXT REFERENCES groups(id) ON DELETE CASCADE");
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS chats_group ON chats(group_id)");
}
