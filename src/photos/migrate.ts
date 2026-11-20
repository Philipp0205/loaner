import type { DatabaseSync } from "node:sqlite";
import { newId } from "../code.js";

export const PHOTOS_SCHEMA = `
-- Up to 6 photos per item, shown in position order. The old items.photo columns are only read by the one-time copy below.
CREATE TABLE IF NOT EXISTS item_photos (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  photo BLOB NOT NULL,
  photo_type TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS item_photos_item ON item_photos(item_id, position);
`;

type Legacy = { id: string; photo: Uint8Array; photo_type: string | null; updated_at: number };

/**
 * Moves each old single photo into item_photos at position 0, then clears the old columns in the same
 * transaction. Safe to run on every start: a cleared item is skipped, and so is one that already has rows,
 * so deleting every photo later can never bring the old one back.
 */
export function migratePhotos(db: DatabaseSync): void {
  const legacy = db
    .prepare(
      `SELECT id, photo, photo_type, updated_at FROM items
       WHERE photo IS NOT NULL AND NOT EXISTS (SELECT 1 FROM item_photos p WHERE p.item_id = items.id)`,
    )
    .all() as unknown as Legacy[];
  const clear = db.prepare("UPDATE items SET photo = NULL, photo_type = NULL WHERE photo IS NOT NULL AND id = ?");
  const insert = db.prepare("INSERT INTO item_photos (id, item_id, position, photo, photo_type, created_at) VALUES (?, ?, 0, ?, ?, ?)");
  const stale = db.prepare("UPDATE items SET photo = NULL, photo_type = NULL WHERE photo IS NOT NULL AND EXISTS (SELECT 1 FROM item_photos p WHERE p.item_id = items.id)");
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of legacy) {
      insert.run(newId(), row.id, row.photo, row.photo_type ?? "image/jpeg", row.updated_at);
      clear.run(row.id);
    }
    // An item that already has rows must not keep an old blob around either.
    stale.run();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
