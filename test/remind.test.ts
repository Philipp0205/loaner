import assert from "node:assert/strict";
import test from "node:test";
import { classify, runReminders, type LentRow } from "../src/remind.js";
import { api, DAY, joinWith, makeGroup, makeItem, ok, signUp, START, withApp } from "./http.js";

const row = (over: Partial<LentRow>): LentRow => ({
  id: "r", item_id: "i", item_name: "Drill", owner_id: "o", owner_name: "Alice", borrower_id: "b", borrower_name: "Bob",
  until_date: "2026-06-10", reminded: 0, nudged_on: null, ...over,
});

test("classify: due tomorrow once, overdue once per day", () => {
  const rows = [
    row({ id: "tomorrow", until_date: "2026-06-10" }),
    row({ id: "tomorrow-done", until_date: "2026-06-10", reminded: 1 }),
    row({ id: "today", until_date: "2026-06-09" }),
    row({ id: "late", until_date: "2026-06-08" }),
    row({ id: "late-nudged-today", until_date: "2026-06-01", nudged_on: "2026-06-09" }),
    row({ id: "late-nudged-yesterday", until_date: "2026-06-01", nudged_on: "2026-06-08" }),
    row({ id: "later", until_date: "2026-06-12" }),
  ];
  const due = classify(rows, "2026-06-09");
  assert.deepEqual(due.dueTomorrow.map((r) => r.id), ["tomorrow"]);
  assert.deepEqual(due.overdue.map((r) => r.id), ["late", "late-nudged-yesterday"]);
});

test("classify: month and year ends", () => {
  assert.deepEqual(classify([row({ until_date: "2027-01-01" })], "2026-12-31").dueTomorrow.length, 1);
  assert.deepEqual(classify([row({ until_date: "2026-03-01" })], "2026-02-28").dueTomorrow.length, 1);
  assert.deepEqual(classify([row({ until_date: "2028-03-01" })], "2028-02-28").dueTomorrow.length, 0, "leap day is between");
});

async function lentUntil(app: Parameters<Parameters<typeof withApp>[0]>[0], until: string) {
  const alice = await signUp(app, "Alice");
  const bob = await signUp(app, "Bob");
  const flat = await makeGroup(app, alice, "Flat");
  await joinWith(app, bob, flat.inviteCode);
  const item = await makeItem(app, alice, [flat.id]);
  const r = (await ok(app, "POST", `/api/items/${item}/requests`, { token: bob.token, status: 201, body: { from: "2026-06-02", until } })).request;
  await ok(app, "POST", `/api/requests/${r.id}/approve`, { token: alice.token });
  await ok(app, "POST", `/api/requests/${r.id}/handover`, { token: alice.token });
  const types = async (who: { token: string }) =>
    (await ok(app, "GET", "/api/notifications", { token: who.token })).notifications.map((n: any) => n.type).filter((t: string) => t === "reminder" || t === "late");
  return { alice, bob, types };
}

test("reminders: the day before the due date both sides hear once, and the nudge starts after", async () => {
  await withApp(async (app) => {
    const { alice, bob, types } = await lentUntil(app, "2026-06-05"); // due Friday; START is Monday 1 June
    assert.deepEqual(await runReminders(app.ctx), { reminded: 0, nudged: 0 });
    app.advance(3 * DAY); // Thursday 4 June, due tomorrow
    assert.deepEqual(await runReminders(app.ctx), { reminded: 1, nudged: 0 });
    assert.deepEqual(await types(alice), ["reminder"]);
    assert.deepEqual(await types(bob), ["reminder"]);
    // Running again, even hours later the same day, sends nothing.
    app.advance(5 * 3_600_000);
    await runReminders(app.ctx);
    await runReminders(app.ctx);
    assert.deepEqual(await types(alice), ["reminder"]);
    assert.deepEqual(await types(bob), ["reminder"]);
    // Due day itself: no nudge yet.
    app.advance(DAY);
    assert.deepEqual(await runReminders(app.ctx), { reminded: 0, nudged: 0 });
    // The day after: overdue, the owner is nudged, the borrower is not.
    app.advance(DAY);
    assert.deepEqual(await runReminders(app.ctx), { reminded: 0, nudged: 1 });
    assert.deepEqual(await types(alice), ["late", "reminder"]);
    assert.deepEqual(await types(bob), ["reminder"]);
    const late = (await ok(app, "GET", "/api/notifications", { token: alice.token })).notifications.find((n: any) => n.type === "late");
    assert.match(late.body, /Cordless drill was due back on 5 Jun/);
  });
});

test("reminders: the overdue nudge is once per day, then again the next day, and stops after return", async () => {
  await withApp(async (app) => {
    const { alice, types } = await lentUntil(app, "2026-06-02");
    app.advance(2 * DAY); // 3 June, overdue
    await runReminders(app.ctx);
    await runReminders(app.ctx);
    assert.equal((await types(alice)).filter((t: string) => t === "late").length, 1);
    app.advance(DAY);
    await runReminders(app.ctx);
    assert.equal((await types(alice)).filter((t: string) => t === "late").length, 2, "a new day, a new nudge");
    const open = app.db.prepare("SELECT id FROM requests WHERE status = 'lent'").get() as { id: string };
    await ok(app, "POST", `/api/requests/${open.id}/return`, { token: alice.token });
    app.advance(DAY);
    assert.deepEqual(await runReminders(app.ctx), { reminded: 0, nudged: 0 });
    assert.equal((await types(alice)).filter((t: string) => t === "late").length, 2);
  });
});

test("reminders: use the app timezone for what tomorrow means", async () => {
  // 2026-06-04 23:30 UTC is already 5 June in Auckland (UTC+12).
  const lateThursdayUtc = Date.parse("2026-06-04T23:30:00Z");
  await withApp(async (app) => {
    const { types, alice } = await lentUntil(app, "2026-06-06");
    app.at(lateThursdayUtc);
    assert.deepEqual(await runReminders(app.ctx), { reminded: 1, nudged: 0 }, "5 June in Auckland, due tomorrow");
    assert.deepEqual(await types(alice), ["reminder"]);
  }, { env: { APP_TZ: "Pacific/Auckland" } });
  await withApp(async (app) => {
    await lentUntil(app, "2026-06-06");
    app.at(lateThursdayUtc);
    assert.deepEqual(await runReminders(app.ctx), { reminded: 0, nudged: 0 }, "still 4 June in UTC");
    assert.ok(START < lateThursdayUtc);
  });
});

test("reminders: only lent requests count, not approved or returned ones", async () => {
  await withApp(async (app) => {
    const alice = await signUp(app, "Alice");
    const bob = await signUp(app, "Bob");
    const flat = await makeGroup(app, alice, "Flat");
    await joinWith(app, bob, flat.inviteCode);
    const item = await makeItem(app, alice, [flat.id]);
    const r = (await ok(app, "POST", `/api/items/${item}/requests`, { token: bob.token, status: 201, body: { from: "2026-06-02", until: "2026-06-02" } })).request;
    await ok(app, "POST", `/api/requests/${r.id}/approve`, { token: alice.token });
    app.advance(DAY * 3);
    assert.deepEqual(await runReminders(app.ctx), { reminded: 0, nudged: 0 });
    const bobNotes = (await api(app, "GET", "/api/notifications", { token: bob.token })).json.notifications as { type: string }[];
    assert.deepEqual(bobNotes.map((n) => n.type).sort(), ["approved", "item_new"], "only the new item and the approval, no reminder");
  });
});
