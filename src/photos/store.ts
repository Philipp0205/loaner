import type { DatabaseSync } from "node:sqlite";
import { newId } from "../code.js";
import { all, get, run } from "../db.js";
import { HttpError } from "../types.js";
import { MAX_PHOTOS } from "./image.js";

export type PhotoBytes = { photo: Uint8Array; photo_type: string };

/** The photo ids of one item, in the order they are shown. */
export function photoIds(db: DatabaseSync, itemId: string): string[] {
  return all<{ id: string }>(db, "SELECT id FROM item_photos WHERE item_id = ? ORDER BY position, created_at, id", itemId).map((row) => row.id);
}

/** One photo of an item, or undefined. */
export function photoOf(db: DatabaseSync, itemId: string, id: string): PhotoBytes | undefined {
  return get<PhotoBytes>(db, "SELECT photo, photo_type FROM item_photos WHERE item_id = ? AND id = ?", itemId, id);
}

/** The first photo of an item (what the legacy single photo routes serve). */
export function firstPhoto(db: DatabaseSync, itemId: string): PhotoBytes | undefined {
  const [id] = photoIds(db, itemId);
  return id ? photoOf(db, itemId, id) : undefined;
}

/** Adds a photo at the end. 409 once the item has the maximum. Caller runs this inside a transaction. */
export function addPhoto(db: DatabaseSync, itemId: string, bytes: Uint8Array, type: string, now: number): string {
  const count = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM item_photos WHERE item_id = ?", itemId)?.n ?? 0;
  if (count >= MAX_PHOTOS) throw new HttpError(409, `an item can have at most ${MAX_PHOTOS} photos`);
  const next = get<{ p: number | null }>(db, "SELECT MAX(position) AS p FROM item_photos WHERE item_id = ?", itemId)?.p ?? -1;
  const id = newId();
  run(db, "INSERT INTO item_photos (id, item_id, position, photo, photo_type, created_at) VALUES (?, ?, ?, ?, ?, ?)", id, itemId, next + 1, bytes, type, now);
  return id;
}

/** Swaps the bytes of the first photo, or adds one when the item has none. */
export function replaceFirst(db: DatabaseSync, itemId: string, bytes: Uint8Array, type: string, now: number): void {
  const [id] = photoIds(db, itemId);
  if (!id) addPhoto(db, itemId, bytes, type, now);
  else run(db, "UPDATE item_photos SET photo = ?, photo_type = ? WHERE id = ?", bytes, type, id);
}

/** Removes one photo. Returns false when the item had no such photo. */
export function removePhoto(db: DatabaseSync, itemId: string, id: string): boolean {
  return run(db, "DELETE FROM item_photos WHERE item_id = ? AND id = ?", itemId, id) > 0;
}
