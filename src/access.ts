import { get } from "./db.js";
import { HttpError, type Ctx } from "./types.js";

export type ItemRow = {
  id: string;
  owner_id: string;
  owner_name: string;
  name: string;
  note: string;
  category: string | null;
  available: number;
  donation_cents: number | null;
  donation_text: string | null;
  has_photo: number;
  updated_at: number;
  created_at: number;
};

/** SQL: 1 when the item has at least one photo. Needs the items table aliased as i. */
export const HAS_PHOTO = "EXISTS (SELECT 1 FROM item_photos p WHERE p.item_id = i.id)";

/** Everything but the photo blobs, so lists never load image bytes. */
export const ITEM_SELECT = `
  SELECT i.id, i.owner_id, u.name AS owner_name, i.name, i.note, i.category, i.available, i.donation_cents, i.donation_text,
         ${HAS_PHOTO} AS has_photo, i.updated_at, i.created_at
  FROM items i JOIN users u ON u.id = i.owner_id`;

/** SQL condition (two params: user id, user id): the user owns the item or shares a group with it. */
export const VISIBLE = `(i.owner_id = ? OR EXISTS (
  SELECT 1 FROM item_groups ig JOIN memberships m ON m.group_id = ig.group_id
  WHERE ig.item_id = i.id AND m.user_id = ?))`;

/** The item if this user owns it or shares a group with it. Otherwise undefined. */
export function visibleItem(ctx: Ctx, userId: string, itemId: string): ItemRow | undefined {
  return get<ItemRow>(ctx.db, `${ITEM_SELECT} WHERE i.id = ? AND ${VISIBLE}`, itemId, userId, userId);
}

/** 404 for an item the user cannot see, so ids reveal nothing. */
export function requireVisibleItem(ctx: Ctx, userId: string, itemId: string): ItemRow {
  const item = visibleItem(ctx, userId, itemId);
  if (!item) throw new HttpError(404, "item not found");
  return item;
}

export function requireOwnedItem(ctx: Ctx, userId: string, itemId: string): ItemRow {
  const item = requireVisibleItem(ctx, userId, itemId);
  if (item.owner_id !== userId) throw new HttpError(403, "only the owner can do that");
  return item;
}

export function isMember(ctx: Ctx, userId: string, groupId: string): boolean {
  return !!get(ctx.db, "SELECT 1 AS x FROM memberships WHERE group_id = ? AND user_id = ?", groupId, userId);
}

/** 404 rather than 403: a non-member learns nothing about whether the group exists. */
export function requireMember(ctx: Ctx, userId: string, groupId: string): void {
  if (!isMember(ctx, userId, groupId)) throw new HttpError(404, "group not found");
}
