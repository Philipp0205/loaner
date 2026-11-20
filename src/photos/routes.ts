import { requireOwnedItem, requireVisibleItem } from "../access.js";
import { run, tx } from "../db.js";
import { HttpError, Reply, me, type Ctx, type Req, type Route } from "../types.js";
import { MAX_PHOTO_BYTES, PHOTO_TYPES, sniff } from "./image.js";
import { addPhoto, firstPhoto, photoIds, photoOf, removePhoto, replaceFirst, type PhotoBytes } from "./store.js";

/** The image bytes of a request, checked: a known type, not empty, and the bytes match the header. */
function uploaded(req: Req): { bytes: Buffer; type: string } {
  const declared = String(req.raw.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (!PHOTO_TYPES.includes(declared)) throw new HttpError(415, "photo must be a JPEG, PNG or WebP image");
  if (req.body.length === 0) throw new HttpError(400, "photo is empty");
  // The bytes must match what the header claims, so a file renamed to .jpg is refused.
  if (sniff(req.body) !== declared) throw new HttpError(415, "that file is not a valid image of the declared type");
  return { bytes: req.body, type: declared };
}

/** A photo changed, so cached copies of the item are stale. */
function touch(ctx: Ctx, itemId: string): void {
  run(ctx.db, "UPDATE items SET updated_at = ? WHERE id = ?", ctx.now(), itemId);
}

function image(found: PhotoBytes | undefined): Reply {
  if (!found) throw new HttpError(404, "no photo");
  return new Reply(200, null, { "content-type": found.photo_type }, Buffer.from(found.photo));
}

/** The photo routes: a list per item, plus the older single photo routes that act on the first photo. */
export function photoRoutes(): Route[] {
  return [
    {
      method: "GET",
      path: "/api/items/:id/photos",
      handler(req) {
        const item = requireVisibleItem(req.ctx, me(req).id, req.params.id);
        return { photoIds: photoIds(req.ctx.db, item.id) };
      },
    },
    {
      method: "POST",
      path: "/api/items/:id/photos",
      maxBody: MAX_PHOTO_BYTES,
      handler(req) {
        const item = requireOwnedItem(req.ctx, me(req).id, req.params.id);
        const { bytes, type } = uploaded(req);
        const id = tx(req.ctx.db, () => {
          const created = addPhoto(req.ctx.db, item.id, bytes, type, req.ctx.now());
          touch(req.ctx, item.id);
          return created;
        });
        return new Reply(201, { id, photoIds: photoIds(req.ctx.db, item.id) });
      },
    },
    {
      method: "GET",
      path: "/api/items/:id/photos/:pid",
      handler(req) {
        const item = requireVisibleItem(req.ctx, me(req).id, req.params.id);
        return image(photoOf(req.ctx.db, item.id, req.params.pid));
      },
    },
    {
      method: "DELETE",
      path: "/api/items/:id/photos/:pid",
      handler(req) {
        const item = requireOwnedItem(req.ctx, me(req).id, req.params.id);
        const removed = tx(req.ctx.db, () => {
          const done = removePhoto(req.ctx.db, item.id, req.params.pid);
          if (done) touch(req.ctx, item.id);
          return done;
        });
        if (!removed) throw new HttpError(404, "no photo");
        return { ok: true, photoIds: photoIds(req.ctx.db, item.id) };
      },
    },
    {
      method: "PUT",
      path: "/api/items/:id/photo",
      maxBody: MAX_PHOTO_BYTES,
      handler(req) {
        const item = requireOwnedItem(req.ctx, me(req).id, req.params.id);
        const { bytes, type } = uploaded(req);
        tx(req.ctx.db, () => {
          replaceFirst(req.ctx.db, item.id, bytes, type, req.ctx.now());
          touch(req.ctx, item.id);
        });
        return { ok: true };
      },
    },
    {
      method: "DELETE",
      path: "/api/items/:id/photo",
      handler(req) {
        const item = requireOwnedItem(req.ctx, me(req).id, req.params.id);
        const [first] = photoIds(req.ctx.db, item.id);
        tx(req.ctx.db, () => {
          if (first) removePhoto(req.ctx.db, item.id, first);
          touch(req.ctx, item.id);
        });
        return { ok: true };
      },
    },
    {
      method: "GET",
      path: "/api/items/:id/photo",
      handler(req) {
        const item = requireVisibleItem(req.ctx, me(req).id, req.params.id);
        return image(firstPhoto(req.ctx.db, item.id));
      },
    },
  ];
}
