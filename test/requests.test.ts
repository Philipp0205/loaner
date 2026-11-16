import assert from "node:assert/strict";
import test from "node:test";
import { api, DAY, joinWith, makeGroup, makeItem, ok, signUp, START, withApp, type Person } from "./http.js";

async function setup(app: { port: number }) {
  const alice = await signUp(app, "Alice");
  const bob = await signUp(app, "Bob");
  const carol = await signUp(app, "Carol");
  const flat = await makeGroup(app, alice, "Flat");
  await joinWith(app, bob, flat.inviteCode);
  await joinWith(app, carol, flat.inviteCode);
  const item = await makeItem(app, alice, [flat.id], { donation: 5 });
  return { alice, bob, carol, flat, item };
}

const ask = (app: { port: number }, who: Person, item: string, from: string, until: string, message = "Please?") =>
  api(app, "POST", `/api/items/${item}/requests`, { token: who.token, body: { from, until, message } });

const act = (app: { port: number }, who: Person, id: string, action: string, body: unknown = {}) =>
  api(app, "POST", `/api/requests/${id}/${action}`, { token: who.token, body });

const notes = async (app: { port: number }, who: Person) =>
  (await ok(app, "GET", "/api/notifications", { token: who.token })).notifications as { type: string; title: string; body: string; read: boolean }[];

test("request: date validation", async () => {
  await withApp(async (app) => {
    const { bob, item } = await setup(app);
    assert.equal((await ask(app, bob, item, "2026-05-31", "2026-06-03")).status, 400, "from in the past");
    assert.equal((await ask(app, bob, item, "2026-06-05", "2026-06-04")).status, 400, "until before from");
    assert.equal((await ask(app, bob, item, "2026-02-30", "2026-03-01")).status, 400, "not a real day");
    assert.equal((await ask(app, bob, item, "next week", "later")).status, 400);
    assert.equal((await ask(app, bob, item, "2026-06-01", "2027-07-01")).status, 400, "longer than a year");
    const noDates = await api(app, "POST", `/api/items/${item}/requests`, { token: bob.token, body: { message: "hi" } });
    assert.equal(noDates.status, 400);
    assert.equal((await ask(app, bob, item, "2026-06-01", "2026-06-01", "x".repeat(281))).status, 400, "message too long");
    const today = await ask(app, bob, item, "2026-06-01", "2026-06-01");
    assert.equal(today.status, 201, "today to today is allowed");
    assert.equal(today.json.request.status, "pending");
  });
});

test("request: not on your own item, not on an item you cannot see, not on a paused item", async () => {
  await withApp(async (app) => {
    const { alice, bob, item, flat } = await setup(app);
    const mallory = await signUp(app, "Mallory");
    assert.equal((await ask(app, alice, item, "2026-06-02", "2026-06-03")).status, 403);
    assert.equal((await ask(app, mallory, item, "2026-06-02", "2026-06-03")).status, 404);
    await ok(app, "PATCH", `/api/items/${item}`, { token: alice.token, body: { available: false } });
    assert.equal((await ask(app, bob, item, "2026-06-02", "2026-06-03")).status, 409);
    assert.ok(flat.id);
  });
});

test("approve: owner only, and a decline can carry a reply", async () => {
  await withApp(async (app) => {
    const { alice, bob, carol, item } = await setup(app);
    const r = (await ask(app, bob, item, "2026-06-05", "2026-06-07")).json.request;
    assert.equal((await act(app, bob, r.id, "approve")).status, 403, "borrower cannot approve own");
    assert.equal((await act(app, carol, r.id, "approve")).status, 404, "stranger to the request");
    assert.equal((await act(app, carol, r.id, "cancel")).status, 404);
    const declined = await act(app, alice, r.id, "decline", { reply: "Sorry, lending it to my dad" });
    assert.equal(declined.status, 200);
    assert.equal(declined.json.request.status, "declined");
    assert.equal(declined.json.request.reply, "Sorry, lending it to my dad");
    assert.equal((await act(app, alice, r.id, "approve")).status, 409, "already decided");
  });
});

test("approve: overlapping pending requests are auto-declined with a notice, others stay", async () => {
  await withApp(async (app) => {
    const { alice, bob, carol, item } = await setup(app);
    const dave = await signUp(app, "Dave");
    const flatId = (await ok(app, "GET", "/api/groups", { token: alice.token })).groups[0];
    await joinWith(app, dave, flatId.inviteCode);
    const rb = (await ask(app, bob, item, "2026-06-10", "2026-06-12")).json.request;
    const rc = (await ask(app, carol, item, "2026-06-12", "2026-06-14")).json.request; // shares 12 June
    const rd = (await ask(app, dave, item, "2026-06-13", "2026-06-15")).json.request; // no overlap with Bob
    const ok1 = await act(app, alice, rb.id, "approve", { reply: "Sure" });
    assert.equal(ok1.status, 200);
    assert.equal(ok1.json.request.status, "approved");

    const status = async (who: Person, id: string) => (await ok(app, "GET", `/api/requests/${id}`, { token: who.token })).request;
    const carolReq = await status(carol, rc.id);
    assert.equal(carolReq.status, "declined");
    assert.equal(carolReq.autoDeclined, true);
    assert.equal((await status(dave, rd.id)).status, "pending");

    const carolNotes = await notes(app, carol);
    assert.ok(carolNotes.some((n) => n.type === "blocked" && /Someone else got these dates/.test(n.body)));
    assert.ok(!(await notes(app, dave)).some((n) => n.type === "blocked"));
    // Approving Dave is fine: his dates do not touch Bob's.
    assert.equal((await act(app, alice, rd.id, "approve")).status, 200);
  });
});

test("approve: 409 when an approved or lent request already covers a day", async () => {
  await withApp(async (app) => {
    const { alice, bob, carol, item } = await setup(app);
    const rb = (await ask(app, bob, item, "2026-06-10", "2026-06-12")).json.request;
    await act(app, alice, rb.id, "approve");
    // A new request that overlaps an approved one is refused up front.
    const blocked = await ask(app, carol, item, "2026-06-11", "2026-06-11");
    assert.equal(blocked.status, 409);
    // Force the race: a pending row that overlaps, approved after the fact.
    const now = START;
    app.ctx.db.prepare(
      "INSERT INTO requests (id, item_id, borrower_id, from_date, until_date, message, status, created_at) VALUES ('forced', ?, ?, '2026-06-12', '2026-06-13', '', 'pending', ?)",
    ).run(item, carol.id, now);
    const res = await act(app, alice, "forced", "approve");
    assert.equal(res.status, 409);
    assert.equal(app.ctx.db.prepare("SELECT status FROM requests WHERE id = 'forced'").get()!.status, "pending");
    // Back to back is not an overlap.
    assert.equal((await ask(app, bob, item, "2026-06-13", "2026-06-14")).status, 201);
    // The same holds once the item is lent.
    await act(app, alice, rb.id, "handover");
    assert.equal((await ask(app, carol, item, "2026-06-10", "2026-06-10")).status, 409);
    assert.equal((await act(app, alice, "forced", "approve")).status, 409);
  });
});

test("borrower can cancel a pending request, the owner is told, then it cannot be approved", async () => {
  await withApp(async (app) => {
    const { alice, bob, item } = await setup(app);
    const r = (await ask(app, bob, item, "2026-06-05", "2026-06-07")).json.request;
    assert.equal((await act(app, alice, r.id, "cancel")).status, 403, "owner cannot cancel for the borrower");
    const cancelled = await act(app, bob, r.id, "cancel");
    assert.equal(cancelled.json.request.status, "cancelled");
    assert.ok((await notes(app, alice)).some((n) => n.type === "request_cancelled"));
    assert.equal((await act(app, alice, r.id, "approve")).status, 409);
    assert.equal((await act(app, bob, r.id, "cancel")).status, 409);
    // The dates are free again.
    assert.equal((await ask(app, bob, item, "2026-06-05", "2026-06-07")).status, 201);
  });
});

test("state machine: pending -> approved -> lent -> returned, in order, owner only", async () => {
  await withApp(async (app) => {
    const { alice, bob, item } = await setup(app);
    const r = (await ask(app, bob, item, "2026-06-05", "2026-06-07")).json.request;
    assert.equal((await act(app, alice, r.id, "handover")).status, 409, "not approved yet");
    assert.equal((await act(app, alice, r.id, "return")).status, 409, "not lent yet");
    await act(app, alice, r.id, "approve");
    assert.equal((await act(app, alice, r.id, "return")).status, 409, "approved is not lent");
    assert.equal((await act(app, bob, r.id, "handover")).status, 403, "borrower cannot hand over");
    assert.equal((await act(app, alice, r.id, "handover")).status, 200);
    assert.equal((await act(app, alice, r.id, "handover")).status, 409, "twice");
    assert.equal((await act(app, alice, r.id, "approve")).status, 409);
    assert.equal((await act(app, bob, r.id, "cancel")).status, 409, "cannot cancel once handed over");
    assert.equal((await act(app, bob, r.id, "return")).status, 403, "borrower cannot mark returned");
    const lentItem = (await ok(app, "GET", `/api/items/${item}`, { token: bob.token })).item;
    assert.equal(lentItem.status, "lent");
    assert.equal(lentItem.lent.to.name, "Bob");
    assert.equal(lentItem.lent.until, "2026-06-07");
    assert.equal((await api(app, "DELETE", `/api/items/${item}`, { token: alice.token })).status, 409, "cannot delete while lent");
    assert.equal((await api(app, "PATCH", `/api/items/${item}`, { token: alice.token, body: { name: "Drill 2" } })).status, 200, "renaming is fine");
    assert.equal((await act(app, alice, r.id, "return")).status, 200);
    assert.equal((await act(app, alice, r.id, "return")).status, 409, "twice");
    assert.equal((await ok(app, "GET", `/api/items/${item}`, { token: bob.token })).item.status, "available");
  });
});

test("handover: only one request can be out at a time", async () => {
  await withApp(async (app) => {
    const { alice, bob, carol, item } = await setup(app);
    const a = (await ask(app, bob, item, "2026-06-05", "2026-06-07")).json.request;
    const b = (await ask(app, carol, item, "2026-06-09", "2026-06-10")).json.request;
    await act(app, alice, a.id, "approve");
    await act(app, alice, b.id, "approve");
    await act(app, alice, a.id, "handover");
    assert.equal((await act(app, alice, b.id, "handover")).status, 409);
    await act(app, alice, a.id, "return");
    assert.equal((await act(app, alice, b.id, "handover")).status, 200);
  });
});

test("history: lists borrowers with dates, handed over and returned times, newest first", async () => {
  await withApp(async (app) => {
    const { alice, bob, carol, item } = await setup(app);
    const a = (await ask(app, bob, item, "2026-06-02", "2026-06-04")).json.request;
    await act(app, alice, a.id, "approve");
    app.advance(DAY);
    await act(app, alice, a.id, "handover");
    const handed = START + DAY;
    app.advance(2 * DAY);
    await act(app, alice, a.id, "return");
    const returned = START + 3 * DAY;
    const b = (await ask(app, carol, item, "2026-06-10", "2026-06-11")).json.request;
    await act(app, alice, b.id, "approve");
    app.advance(DAY);
    await act(app, alice, b.id, "handover");

    const detail = await ok(app, "GET", `/api/items/${item}`, { token: carol.token });
    assert.equal(detail.history.length, 2);
    assert.deepEqual(detail.history[1], {
      requestId: a.id, borrower: { id: bob.id, name: "Bob" }, from: "2026-06-02", until: "2026-06-04", handedOverAt: handed, returnedAt: returned,
    });
    assert.equal(detail.history[0].borrower.name, "Carol");
    assert.equal(detail.history[0].returnedAt, null);
    // Declined or merely approved requests are not history.
    const c = (await ask(app, bob, item, "2026-06-20", "2026-06-21")).json.request;
    await act(app, alice, c.id, "decline");
    assert.equal((await ok(app, "GET", `/api/items/${item}`, { token: bob.token })).history.length, 2);
  });
});

test("request lists: owner sees incoming, borrower sees outgoing, nobody sees others", async () => {
  await withApp(async (app) => {
    const { alice, bob, carol, item } = await setup(app);
    await ask(app, bob, item, "2026-06-05", "2026-06-06");
    await ask(app, carol, item, "2026-06-08", "2026-06-09");
    const incoming = (await ok(app, "GET", "/api/requests", { token: alice.token })).requests;
    assert.deepEqual(incoming.map((r: any) => r.borrower.name).sort(), ["Bob", "Carol"]);
    assert.deepEqual((await ok(app, "GET", "/api/requests", { token: bob.token })).requests, []);
    const outgoing = (await ok(app, "GET", "/api/requests?role=outgoing", { token: bob.token })).requests;
    assert.deepEqual(outgoing.map((r: any) => r.borrower.name), ["Bob"]);
    assert.equal(outgoing[0].item.name, "Cordless drill");
  });
});

test("deleting an item closes open requests and tells the borrowers", async () => {
  await withApp(async (app) => {
    const { alice, bob, item } = await setup(app);
    const r = (await ask(app, bob, item, "2026-06-05", "2026-06-06")).json.request;
    await ok(app, "DELETE", `/api/items/${item}`, { token: alice.token });
    assert.equal((await api(app, "GET", `/api/requests/${r.id}`, { token: bob.token })).status, 404);
    assert.ok((await notes(app, bob)).some((n) => n.type === "item_removed"));
  });
});

test("notifications: one is created for each event, to the right person", async () => {
  await withApp(async (app) => {
    const { alice, bob, carol, item } = await setup(app);
    const types = async (who: Person) => (await notes(app, who)).map((n) => n.type).sort();
    const rb = (await ask(app, bob, item, "2026-06-05", "2026-06-07")).json.request;
    const rc = (await ask(app, carol, item, "2026-06-06", "2026-06-08")).json.request;
    assert.deepEqual(await types(alice), ["request_new", "request_new"]);
    assert.deepEqual(await types(bob), ["item_new"], "bob only heard about the new item");

    await act(app, alice, rb.id, "approve");
    assert.deepEqual(await types(bob), ["approved", "item_new"]);
    assert.deepEqual(await types(carol), ["blocked", "item_new"], "carol lost the overlapping dates");
    assert.ok(rc.id);

    await act(app, alice, rb.id, "handover");
    assert.deepEqual(await types(bob), ["approved", "handed_over", "item_new"]);
    await act(app, alice, rb.id, "return");
    assert.deepEqual(await types(bob), ["approved", "handed_over", "item_new", "returned"]);

    const rd = (await ask(app, bob, item, "2026-06-20", "2026-06-21")).json.request;
    await act(app, alice, rd.id, "decline");
    assert.deepEqual(await types(bob), ["approved", "declined", "handed_over", "item_new", "returned"]);
    // Alice only ever heard about new requests, never her own item.
    assert.deepEqual(await types(alice), ["request_new", "request_new", "request_new"]);
    const first = (await notes(app, bob)).find((n) => n.type === "approved")!;
    assert.match(first.body, /Alice said yes to Cordless drill/);
  });
});

test("notifications: unread count, mark one read, mark all read, only your own", async () => {
  await withApp(async (app) => {
    const { alice, bob, item } = await setup(app);
    await ask(app, bob, item, "2026-06-05", "2026-06-07");
    await ask(app, bob, item, "2026-06-10", "2026-06-11");
    assert.equal((await ok(app, "GET", "/api/me", { token: alice.token })).unread, 2);
    const list = (await ok(app, "GET", "/api/notifications", { token: alice.token }));
    assert.equal(list.unread, 2);
    const id = list.notifications[0].id;
    assert.equal((await api(app, "POST", `/api/notifications/${id}/read`, { token: bob.token })).status, 404, "not bob's");
    assert.equal((await ok(app, "POST", `/api/notifications/${id}/read`, { token: alice.token })).unread, 1);
    assert.equal((await ok(app, "POST", "/api/notifications/read", { token: alice.token })).unread, 0);
    assert.equal((await ok(app, "GET", "/api/me", { token: alice.token })).unread, 0);
    assert.ok((await notes(app, alice)).every((n) => n.read));
  });
});
