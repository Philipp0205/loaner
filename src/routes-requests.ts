import { requireVisibleItem } from "./access.js";
import { newId } from "./code.js";
import { all, get, run, tx } from "./db.js";
import { addNote, flush, type PendingPush } from "./notify.js";
import { addDays, isoDate, shortDate } from "./time.js";
import { HttpError, Reply, jsonBody, me, type Ctx, type Route, type User } from "./types.js";
import { date, longText } from "./validate.js";

export type RequestRow = {
  id: string;
  item_id: string;
  item_name: string;
  owner_id: string;
  owner_name: string;
  borrower_id: string;
  borrower_name: string;
  from_date: string;
  until_date: string;
  message: string;
  reply: string;
  status: string;
  auto_declined: number;
  created_at: number;
  decided_at: number | null;
  handed_over_at: number | null;
  returned_at: number | null;
};

const REQUEST_SELECT = `
  SELECT r.id, r.item_id, i.name AS item_name, i.owner_id, o.name AS owner_name,
         r.borrower_id, b.name AS borrower_name, r.from_date, r.until_date, r.message, r.reply,
         r.status, r.auto_declined, r.created_at, r.decided_at, r.handed_over_at, r.returned_at
  FROM requests r
  JOIN items i ON i.id = r.item_id
  JOIN users o ON o.id = i.owner_id
  JOIN users b ON b.id = r.borrower_id`;

const MAX_DAYS = 365;

function requestView(row: RequestRow) {
  return {
    id: row.id,
    item: { id: row.item_id, name: row.item_name },
    owner: { id: row.owner_id, name: row.owner_name },
    borrower: { id: row.borrower_id, name: row.borrower_name },
    from: row.from_date,
    until: row.until_date,
    message: row.message,
    reply: row.reply,
    status: row.status,
    autoDeclined: !!row.auto_declined,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    handedOverAt: row.handed_over_at,
    returnedAt: row.returned_at,
  };
}

/** A request the caller is part of (as owner or borrower). Anyone else gets 404. */
function requireRequest(ctx: Ctx, user: User, id: string): RequestRow {
  const row = get<RequestRow>(ctx.db, `${REQUEST_SELECT} WHERE r.id = ?`, id);
  if (!row || (row.owner_id !== user.id && row.borrower_id !== user.id)) throw new HttpError(404, "request not found");
  return row;
}

function requireOwner(user: User, row: RequestRow): void {
  if (row.owner_id !== user.id) throw new HttpError(403, "only the owner can do that");
}

/** True when two inclusive date ranges share a day. */
export function overlaps(aFrom: string, aUntil: string, bFrom: string, bUntil: string): boolean {
  return aFrom <= bUntil && bFrom <= aUntil;
}

/** Another approved or lent request on this item that shares a day with the range. */
function conflictingBooking(ctx: Ctx, itemId: string, from: string, until: string, exceptId: string): { id: string } | undefined {
  return get<{ id: string }>(
    ctx.db,
    "SELECT id FROM requests WHERE item_id = ? AND id <> ? AND status IN ('approved', 'lent') AND from_date <= ? AND until_date >= ?",
    itemId,
    exceptId,
    until,
    from,
  );
}

function span(from: string, until: string): string {
  return from === until ? shortDate(from) : `${shortDate(from)} to ${shortDate(until)}`;
}

export function requestRoutes(): Route[] {
  return [
    {
      method: "POST",
      path: "/api/items/:id/requests",
      async handler(req) {
        const user = me(req);
        const item = requireVisibleItem(req.ctx, user.id, req.params.id);
        if (item.owner_id === user.id) throw new HttpError(403, "you cannot request your own item");
        const body = jsonBody(req);
        const from = date(body.from, "from");
        const until = date(body.until, "until");
        const message = longText(body.message, "message", 280);
        const today = isoDate(req.ctx.now(), req.ctx.config.tz);
        if (from < today) throw new HttpError(400, "from cannot be in the past");
        if (until < from) throw new HttpError(400, "until cannot be before from");
        if (until > addDays(from, MAX_DAYS)) throw new HttpError(400, "a request can cover at most a year");
        if (!item.available) throw new HttpError(409, "this item is paused right now");
        const id = newId();
        const pending: PendingPush[] = [];
        tx(req.ctx.db, () => {
          if (conflictingBooking(req.ctx, item.id, from, until, id)) throw new HttpError(409, "those dates are already taken");
          const twin = get(
            req.ctx.db,
            "SELECT 1 AS x FROM requests WHERE item_id = ? AND borrower_id = ? AND status = 'pending' AND from_date <= ? AND until_date >= ?",
            item.id, user.id, until, from,
          );
          if (twin) throw new HttpError(409, "you already asked for those dates");
          run(
            req.ctx.db,
            "INSERT INTO requests (id, item_id, borrower_id, from_date, until_date, message, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)",
            id, item.id, user.id, from, until, message, req.ctx.now(),
          );
          pending.push(
            addNote(req.ctx, {
              userId: item.owner_id, type: "request_new", itemId: item.id, requestId: id,
              title: "New request",
              body: `${user.name} would like ${item.name}, ${span(from, until)}.`,
            }),
          );
        });
        await flush(req.ctx, pending);
        return new Reply(201, { request: requestView(requireRequest(req.ctx, user, id)) });
      },
    },
    {
      // role=incoming (default): requests on my items. role=outgoing: my own requests.
      method: "GET",
      path: "/api/requests",
      handler(req) {
        const user = me(req);
        const outgoing = req.query.get("role") === "outgoing";
        const rows = all<RequestRow>(
          req.ctx.db,
          `${REQUEST_SELECT} WHERE ${outgoing ? "r.borrower_id" : "i.owner_id"} = ?
           ORDER BY CASE r.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 WHEN 'lent' THEN 2 ELSE 3 END, r.from_date, r.created_at DESC, r.id`,
          user.id,
        );
        return { requests: rows.map(requestView) };
      },
    },
    {
      method: "GET",
      path: "/api/requests/:id",
      handler(req) {
        const user = me(req);
        return { request: requestView(requireRequest(req.ctx, user, req.params.id)) };
      },
    },
    {
      method: "POST",
      path: "/api/requests/:id/approve",
      async handler(req) {
        const user = me(req);
        const row = requireRequest(req.ctx, user, req.params.id);
        requireOwner(user, row);
        if (row.status !== "pending") throw new HttpError(409, `this request is already ${row.status}`);
        const reply = longText(jsonBody(req).reply, "reply", 280);
        const pending: PendingPush[] = [];
        tx(req.ctx.db, () => {
          if (conflictingBooking(req.ctx, row.item_id, row.from_date, row.until_date, row.id)) {
            throw new HttpError(409, "those dates overlap a request you already approved or lent out");
          }
          run(req.ctx.db, "UPDATE requests SET status = 'approved', reply = ?, decided_at = ? WHERE id = ?", reply, req.ctx.now(), row.id);
          pending.push(
            addNote(req.ctx, {
              userId: row.borrower_id, type: "approved", itemId: row.item_id, requestId: row.id,
              title: "Request approved",
              body: `${user.name} said yes to ${row.item_name}, ${span(row.from_date, row.until_date)}.${reply ? ` "${reply}"` : ""}`,
            }),
          );
          // Everyone else waiting on these dates loses them.
          const others = all<{ id: string; borrower_id: string }>(
            req.ctx.db,
            "SELECT id, borrower_id FROM requests WHERE item_id = ? AND id <> ? AND status = 'pending' AND from_date <= ? AND until_date >= ?",
            row.item_id, row.id, row.until_date, row.from_date,
          );
          for (const other of others) {
            run(req.ctx.db, "UPDATE requests SET status = 'declined', auto_declined = 1, decided_at = ? WHERE id = ?", req.ctx.now(), other.id);
            pending.push(
              addNote(req.ctx, {
                userId: other.borrower_id, type: "blocked", itemId: row.item_id, requestId: other.id,
                title: "Dates no longer free",
                body: `Someone else got these dates for ${row.item_name}. Your request was closed.`,
              }),
            );
          }
        });
        await flush(req.ctx, pending);
        return { request: requestView(requireRequest(req.ctx, user, row.id)) };
      },
    },
    {
      method: "POST",
      path: "/api/requests/:id/decline",
      async handler(req) {
        const user = me(req);
        const row = requireRequest(req.ctx, user, req.params.id);
        requireOwner(user, row);
        if (row.status !== "pending") throw new HttpError(409, `this request is already ${row.status}`);
        const reply = longText(jsonBody(req).reply, "reply", 280);
        run(req.ctx.db, "UPDATE requests SET status = 'declined', reply = ?, decided_at = ? WHERE id = ?", reply, req.ctx.now(), row.id);
        const pending = [
          addNote(req.ctx, {
            userId: row.borrower_id, type: "declined", itemId: row.item_id, requestId: row.id,
            title: "Request declined",
            body: `${user.name} cannot lend ${row.item_name} for ${span(row.from_date, row.until_date)}.${reply ? ` "${reply}"` : ""}`,
          }),
        ];
        await flush(req.ctx, pending);
        return { request: requestView(requireRequest(req.ctx, user, row.id)) };
      },
    },
    {
      // The borrower withdraws a request that is still pending or approved (not yet handed over).
      method: "POST",
      path: "/api/requests/:id/cancel",
      async handler(req) {
        const user = me(req);
        const row = requireRequest(req.ctx, user, req.params.id);
        if (row.borrower_id !== user.id) throw new HttpError(403, "only the borrower can cancel");
        if (row.status !== "pending" && row.status !== "approved") throw new HttpError(409, `this request is already ${row.status}`);
        run(req.ctx.db, "UPDATE requests SET status = 'cancelled', decided_at = ? WHERE id = ?", req.ctx.now(), row.id);
        const pending = [
          addNote(req.ctx, {
            userId: row.owner_id, type: "request_cancelled", itemId: row.item_id, requestId: row.id,
            title: "Request cancelled",
            body: `${user.name} cancelled the request for ${row.item_name}, ${span(row.from_date, row.until_date)}.`,
          }),
        ];
        await flush(req.ctx, pending);
        return { request: requestView(requireRequest(req.ctx, user, row.id)) };
      },
    },
    {
      method: "POST",
      path: "/api/requests/:id/handover",
      async handler(req) {
        const user = me(req);
        const row = requireRequest(req.ctx, user, req.params.id);
        requireOwner(user, row);
        if (row.status !== "approved") throw new HttpError(409, row.status === "pending" ? "approve the request first" : `this request is already ${row.status}`);
        const out = get(req.ctx.db, "SELECT 1 AS x FROM requests WHERE item_id = ? AND status = 'lent'", row.item_id);
        if (out) throw new HttpError(409, "this item is still lent out to someone else");
        run(req.ctx.db, "UPDATE requests SET status = 'lent', handed_over_at = ? WHERE id = ?", req.ctx.now(), row.id);
        const pending = [
          addNote(req.ctx, {
            userId: row.borrower_id, type: "handed_over", itemId: row.item_id, requestId: row.id,
            title: "Handed over",
            body: `You have ${row.item_name} from ${user.name}. Please return it by ${shortDate(row.until_date)}.`,
          }),
        ];
        await flush(req.ctx, pending);
        return { request: requestView(requireRequest(req.ctx, user, row.id)) };
      },
    },
    {
      method: "POST",
      path: "/api/requests/:id/return",
      async handler(req) {
        const user = me(req);
        const row = requireRequest(req.ctx, user, req.params.id);
        requireOwner(user, row);
        if (row.status !== "lent") throw new HttpError(409, row.status === "returned" ? "this request is already returned" : "this item has not been handed over");
        run(req.ctx.db, "UPDATE requests SET status = 'returned', returned_at = ? WHERE id = ?", req.ctx.now(), row.id);
        const pending = [
          addNote(req.ctx, {
            userId: row.borrower_id, type: "returned", itemId: row.item_id, requestId: row.id,
            title: "Returned",
            body: `${user.name} marked ${row.item_name} as returned. Thank you!`,
          }),
        ];
        await flush(req.ctx, pending);
        return { request: requestView(requireRequest(req.ctx, user, row.id)) };
      },
    },
  ];
}
