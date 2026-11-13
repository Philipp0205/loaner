import { all, run } from "./db.js";
import { addNote, flush, type PendingPush } from "./notify.js";
import { addDays, isoDate, shortDate } from "./time.js";
import type { Ctx } from "./types.js";

export type LentRow = {
  id: string;
  item_id: string;
  item_name: string;
  owner_id: string;
  owner_name: string;
  borrower_id: string;
  borrower_name: string;
  until_date: string;
  reminded: number;
  nudged_on: string | null;
};

export type Due = {
  /** Due tomorrow and not reminded yet. Both sides get one reminder. */
  dueTomorrow: LentRow[];
  /** Past the due date and not nudged today. The owner gets at most one nudge a day. */
  overdue: LentRow[];
};

/** Pure: which lent requests need a message, given today's date in the app timezone. */
export function classify(rows: LentRow[], today: string): Due {
  const tomorrow = addDays(today, 1);
  return {
    dueTomorrow: rows.filter((row) => row.until_date === tomorrow && !row.reminded),
    overdue: rows.filter((row) => row.until_date < today && row.nudged_on !== today),
  };
}

/** Finds due items for `now` in `tz`. Reads only. */
export function findDue(ctx: Ctx, now: number, tz: string): Due {
  const rows = all<LentRow>(
    ctx.db,
    `SELECT r.id, r.item_id, i.name AS item_name, i.owner_id, o.name AS owner_name,
            r.borrower_id, b.name AS borrower_name, r.until_date, r.reminded, r.nudged_on
     FROM requests r JOIN items i ON i.id = r.item_id
     JOIN users o ON o.id = i.owner_id JOIN users b ON b.id = r.borrower_id
     WHERE r.status = 'lent'
     ORDER BY r.until_date, r.id`,
  );
  return classify(rows, isoDate(now, tz));
}

/** Creates the reminder and nudge notifications that are due now, then sends any push. Safe to run often. */
export async function runReminders(ctx: Ctx): Promise<{ reminded: number; nudged: number }> {
  const now = ctx.now();
  const today = isoDate(now, ctx.config.tz);
  const due = findDue(ctx, now, ctx.config.tz);
  const pending: PendingPush[] = [];
  for (const row of due.dueTomorrow) {
    // Claim the row first so two overlapping runs cannot both send.
    if (run(ctx.db, "UPDATE requests SET reminded = 1 WHERE id = ? AND reminded = 0", row.id) === 0) continue;
    pending.push(
      addNote(ctx, {
        userId: row.borrower_id, type: "reminder", itemId: row.item_id, requestId: row.id,
        title: "Due tomorrow",
        body: `Please return ${row.item_name} to ${row.owner_name} tomorrow (${shortDate(row.until_date)}).`,
      }),
      addNote(ctx, {
        userId: row.owner_id, type: "reminder", itemId: row.item_id, requestId: row.id,
        title: "Due tomorrow",
        body: `${row.borrower_name} should return ${row.item_name} tomorrow (${shortDate(row.until_date)}).`,
      }),
    );
  }
  let nudged = 0;
  for (const row of due.overdue) {
    if (run(ctx.db, "UPDATE requests SET nudged_on = ? WHERE id = ? AND (nudged_on IS NULL OR nudged_on <> ?)", today, row.id, today) === 0) continue;
    nudged += 1;
    pending.push(
      addNote(ctx, {
        userId: row.owner_id, type: "late", itemId: row.item_id, requestId: row.id,
        title: "Overdue",
        body: `${row.item_name} was due back on ${shortDate(row.until_date)}. ${row.borrower_name} still has it.`,
      }),
    );
  }
  await flush(ctx, pending);
  return { reminded: due.dueTomorrow.length, nudged };
}
