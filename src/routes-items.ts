import { ITEM_SELECT, VISIBLE, isMember, requireOwnedItem, requireVisibleItem, requireMember, type ItemRow } from "./access.js";
import { newId } from "./code.js";
import { all, get, run, tx } from "./db.js";
import { addNote, flush, type PendingPush } from "./notify.js";
import { HttpError, Reply, jsonBody, me, type Ctx, type Route } from "./types.js";
import { centsToAmount, donationCents, longText, stringArray, text } from "./validate.js";
import { isoDate } from "./time.js";

export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

type RequestRow = { id: string; borrower_id: string; borrower_name: string; from_date: string; until_date: string; handed_over_at: number | null; returned_at: number | null; status: string };

/** The open lend, if any: the request that is currently out. */
function lentRequest(ctx: Ctx, itemId: string): RequestRow | undefined {
  return get<RequestRow>(
    ctx.db,
    `SELECT r.id, r.borrower_id, u.name AS borrower_name, r.from_date, r.until_date, r.handed_over_at, r.returned_at, r.status
     FROM requests r JOIN users u ON u.id = r.borrower_id WHERE r.item_id = ? AND r.status = 'lent'`,
    itemId,
  );
}

function itemGroupIds(ctx: Ctx, itemId: string, viewerId: string, ownerId: string): string[] {
  // The owner sees every group it is shared with. Others only see the groups they are in too.
  const rows = all<{ group_id: string }>(
    ctx.db,
    viewerId === ownerId
      ? "SELECT group_id FROM item_groups WHERE item_id = ?"
      : "SELECT ig.group_id FROM item_groups ig JOIN memberships m ON m.group_id = ig.group_id AND m.user_id = ? WHERE ig.item_id = ?",
    ...(viewerId === ownerId ? [itemId] : [viewerId, itemId]),
  );
  return rows.map((row) => row.group_id);
}

/** What the API shows about one item to one viewer. */
export function itemView(ctx: Ctx, item: ItemRow, viewerId: string) {
  const lent = lentRequest(ctx, item.id);
  const today = isoDate(ctx.now(), ctx.config.tz);
  const status = lent ? "lent" : item.available ? "available" : "paused";
  return {
    id: item.id,
    name: item.name,
    note: item.note,
    owner: { id: item.owner_id, name: item.owner_name },
    mine: item.owner_id === viewerId,
    available: !!item.available,
    status,
    lent: lent ? { to: { id: lent.borrower_id, name: lent.borrower_name }, until: lent.until_date, late: lent.until_date < today, requestId: lent.id } : null,
    donation: centsToAmount(item.donation_cents),
    hasPhoto: !!item.has_photo,
    photoVersion: item.updated_at,
    groupIds: itemGroupIds(ctx, item.id, viewerId, item.owner_id),
  };
}

function history(ctx: Ctx, itemId: string) {
  return all<RequestRow>(
    ctx.db,
    `SELECT r.id, r.borrower_id, u.name AS borrower_name, r.from_date, r.until_date, r.handed_over_at, r.returned_at, r.status
     FROM requests r JOIN users u ON u.id = r.borrower_id WHERE r.item_id = ? AND r.handed_over_at IS NOT NULL
     ORDER BY r.handed_over_at DESC, r.id`,
    itemId,
  ).map((row) => ({
    requestId: row.id,
    borrower: { id: row.borrower_id, name: row.borrower_name },
    from: row.from_date,
    until: row.until_date,
    handedOverAt: row.handed_over_at,
    returnedAt: row.returned_at,
  }));
}

/** Validates the chosen groups: all must be groups the owner is in. */
function ownerGroups(ctx: Ctx, userId: string, value: unknown): string[] {
  const ids = stringArray(value, "groupIds", 50);
  if (ids.length === 0) throw new HttpError(400, "choose at least one group");
  for (const id of ids) if (!isMember(ctx, userId, id)) throw new HttpError(400, "you can only share with groups you are in");
  return ids;
}

function setGroups(ctx: Ctx, itemId: string, groupIds: string[]): void {
  run(ctx.db, "DELETE FROM item_groups WHERE item_id = ?", itemId);
  for (const groupId of groupIds) run(ctx.db, "INSERT INTO item_groups (item_id, group_id) VALUES (?, ?)", itemId, groupId);
}

export function sniff(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 12 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return null;
}

export function itemRoutes(): Route[] {
  return [
    {
      method: "POST",
      path: "/api/items",
      handler(req) {
        const user = me(req);
        const body = jsonBody(req);
        const name = text(body.name, "name", 1, 60);
        const note = longText(body.note, "note", 280);
        const cents = donationCents(body.donation);
        const groupIds = ownerGroups(req.ctx, user.id, body.groupIds);
        const id = newId();
        const now = req.ctx.now();
        tx(req.ctx.db, () => {
          run(
            req.ctx.db,
            "INSERT INTO items (id, owner_id, name, note, available, donation_cents, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)",
            id, user.id, name, note, cents, now, now,
          );
          setGroups(req.ctx, id, groupIds);
        });
        return new Reply(201, { item: itemView(req.ctx, requireVisibleItem(req.ctx, user.id, id), user.id) });
      },
    },
    {
      method: "GET",
      path: "/api/items/mine",
      handler(req) {
        const user = me(req);
        const rows = all<ItemRow>(req.ctx.db, `${ITEM_SELECT} WHERE i.owner_id = ? ORDER BY i.created_at DESC, i.id`, user.id);
        return { items: rows.map((row) => itemView(req.ctx, row, user.id)) };
      },
    },
    {
      method: "GET",
      path: "/api/groups/:id/items",
      handler(req) {
        const user = me(req);
        requireMember(req.ctx, user.id, req.params.id);
        const rows = all<ItemRow>(
          req.ctx.db,
          `${ITEM_SELECT} WHERE EXISTS (SELECT 1 FROM item_groups ig WHERE ig.item_id = i.id AND ig.group_id = ?)
           ORDER BY i.created_at DESC, i.id`,
          req.params.id,
        );
        let items = rows.map((row) => itemView(req.ctx, row, user.id));
        if (req.query.get("available") === "1") items = items.filter((item) => item.status === "available");
        return { items };
      },
    },
    {
      method: "GET",
      path: "/api/items/:id",
      handler(req) {
        const user = me(req);
        const item = requireVisibleItem(req.ctx, user.id, req.params.id);
        const mine = all<{ id: string }>(
          req.ctx.db,
          "SELECT id FROM requests WHERE item_id = ? AND borrower_id = ? AND status IN ('pending', 'approved', 'lent') ORDER BY created_at",
          item.id,
          user.id,
        ).map((row) => row.id);
        return { item: itemView(req.ctx, item, user.id), history: history(req.ctx, item.id), myRequestIds: mine };
      },
    },
    {
      method: "PATCH",
      path: "/api/items/:id",
      handler(req) {
        const user = me(req);
        const item = requireOwnedItem(req.ctx, user.id, req.params.id);
        const body = jsonBody(req);
        const name = "name" in body ? text(body.name, "name", 1, 60) : item.name;
        const note = "note" in body ? longText(body.note, "note", 280) : item.note;
        const cents = "donation" in body ? donationCents(body.donation) : item.donation_cents;
        let available = item.available;
        if ("available" in body) {
          if (typeof body.available !== "boolean") throw new HttpError(400, "available must be true or false");
          available = body.available ? 1 : 0;
        }
        const groupIds = "groupIds" in body ? ownerGroups(req.ctx, user.id, body.groupIds) : null;
        tx(req.ctx.db, () => {
          run(req.ctx.db, "UPDATE items SET name = ?, note = ?, donation_cents = ?, available = ?, updated_at = ? WHERE id = ?", name, note, cents, available, req.ctx.now(), item.id);
          if (groupIds) setGroups(req.ctx, item.id, groupIds);
        });
        return { item: itemView(req.ctx, requireVisibleItem(req.ctx, user.id, item.id), user.id) };
      },
    },
    {
      method: "DELETE",
      path: "/api/items/:id",
      async handler(req) {
        const user = me(req);
        const item = requireOwnedItem(req.ctx, user.id, req.params.id);
        if (lentRequest(req.ctx, item.id)) throw new HttpError(409, "mark it returned before deleting it");
        const pending: PendingPush[] = [];
        tx(req.ctx.db, () => {
          const open = all<{ id: string; borrower_id: string }>(
            req.ctx.db,
            "SELECT id, borrower_id FROM requests WHERE item_id = ? AND status IN ('pending', 'approved')",
            item.id,
          );
          for (const request of open) {
            pending.push(
              addNote(req.ctx, { userId: request.borrower_id, type: "item_removed", title: "Item removed", body: `${user.name} removed ${item.name}, so your request is closed.` }),
            );
          }
          run(req.ctx.db, "DELETE FROM items WHERE id = ?", item.id);
        });
        await flush(req.ctx, pending);
        return { ok: true };
      },
    },
    {
      method: "PUT",
      path: "/api/items/:id/photo",
      maxBody: MAX_PHOTO_BYTES,
      handler(req) {
        const user = me(req);
        const item = requireOwnedItem(req.ctx, user.id, req.params.id);
        const declared = (req.raw.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
        if (!["image/jpeg", "image/png", "image/webp"].includes(declared)) throw new HttpError(415, "photo must be a JPEG, PNG or WebP image");
        if (req.body.length === 0) throw new HttpError(400, "photo is empty");
        // The bytes must match what the header claims, so a file renamed to .jpg is refused.
        if (sniff(req.body) !== declared) throw new HttpError(415, "that file is not a valid image of the declared type");
        run(req.ctx.db, "UPDATE items SET photo = ?, photo_type = ?, updated_at = ? WHERE id = ?", req.body, declared, req.ctx.now(), item.id);
        return { ok: true };
      },
    },
    {
      method: "DELETE",
      path: "/api/items/:id/photo",
      handler(req) {
        const user = me(req);
        const item = requireOwnedItem(req.ctx, user.id, req.params.id);
        run(req.ctx.db, "UPDATE items SET photo = NULL, photo_type = NULL, updated_at = ? WHERE id = ?", req.ctx.now(), item.id);
        return { ok: true };
      },
    },
    {
      method: "GET",
      path: "/api/items/:id/photo",
      handler(req) {
        const user = me(req);
        const row = get<{ photo: Uint8Array | null; photo_type: string | null }>(
          req.ctx.db,
          `SELECT i.photo, i.photo_type FROM items i WHERE i.id = ? AND ${VISIBLE}`,
          req.params.id,
          user.id,
          user.id,
        );
        if (!row || !row.photo || !row.photo_type) throw new HttpError(404, "no photo");
        return new Reply(200, null, { "content-type": row.photo_type }, Buffer.from(row.photo));
      },
    },
  ];
}
