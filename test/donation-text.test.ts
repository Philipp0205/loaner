import assert from "node:assert/strict";
import test from "node:test";
import { api, joinWith, makeGroup, makeItem, ok, signUp, withApp } from "./http.js";

// The suggested donation is an amount or a few words, never both. The app never touches money.

async function setup(app: { port: number }) {
  const owner = await signUp(app, "Olga");
  const friend = await signUp(app, "Fred");
  const group = await makeGroup(app, owner, "Flat");
  await joinWith(app, friend, group.inviteCode);
  return { owner, friend, group };
}

const read = async (app: { port: number }, token: string, id: string) => (await ok(app, "GET", `/api/items/${id}`, { token })).item;

test("donation text: an item can suggest words, and members see them", async () => {
  await withApp(async (app) => {
    const { owner, friend, group } = await setup(app);
    const id = await makeItem(app, owner, [group.id], { donationText: "  a beer  " });
    const item = await read(app, friend.token, id);
    assert.equal(item.donationText, "a beer", "trimmed");
    assert.equal(item.donation, null);
  });
});

test("donation text: an amount still works and has no words", async () => {
  await withApp(async (app) => {
    const { owner, group } = await setup(app);
    const id = await makeItem(app, owner, [group.id], { donation: 5 });
    const item = await read(app, owner.token, id);
    assert.deepEqual([item.donation, item.donationText], [5, null]);
  });
});

test("donation text: empty or null means none", async () => {
  await withApp(async (app) => {
    const { owner, group } = await setup(app);
    for (const extra of [{ donationText: "" }, { donationText: "   " }, { donationText: null }, {}]) {
      const item = await read(app, owner.token, await makeItem(app, owner, [group.id], extra));
      assert.deepEqual([item.donation, item.donationText], [null, null]);
    }
  });
});

test("donation text: 60 characters fit, 61 do not, and emoji count as one", async () => {
  await withApp(async (app) => {
    const { owner, group } = await setup(app);
    const body = (donationText: string) => ({ name: "Drill", note: "", groupIds: [group.id], donationText });
    assert.equal((await api(app, "POST", "/api/items", { token: owner.token, body: body("a".repeat(60)) })).status, 201);
    assert.equal((await api(app, "POST", "/api/items", { token: owner.token, body: body("🍺".repeat(60)) })).status, 201);
    const long = await api(app, "POST", "/api/items", { token: owner.token, body: body("a".repeat(61)) });
    assert.equal(long.status, 400);
    assert.match(long.json.error, /at most 60/);
  });
});

test("donation text: bad values are refused", async () => {
  await withApp(async (app) => {
    const { owner, group } = await setup(app);
    const send = (extra: Record<string, unknown>) => api(app, "POST", "/api/items", { token: owner.token, body: { name: "Drill", note: "", groupIds: [group.id], ...extra } });
    assert.equal((await send({ donationText: 5 })).status, 400, "not text");
    assert.equal((await send({ donationText: "5" })).status, 400, "a bare number belongs in donation");
    assert.equal((await send({ donationText: "12,50" })).status, 400);
    assert.equal((await send({ donationText: "a beer", donation: 5 })).status, 400, "both set");
    assert.equal((await send({ donationText: "5 euros" })).status, 201, "words with a number in them are fine");
  });
});

test("donation text: PATCH keeps, replaces or clears, and an amount replaces words", async () => {
  await withApp(async (app) => {
    const { owner, group } = await setup(app);
    const id = await makeItem(app, owner, [group.id], { donationText: "a beer" });
    const patch = (body: Record<string, unknown>) => ok(app, "PATCH", `/api/items/${id}`, { token: owner.token, body }).then((json) => json.item);

    let item = await patch({ note: "New note" });
    assert.equal(item.donationText, "a beer", "an update that names neither field keeps it");

    item = await patch({ donationText: "cake" });
    assert.deepEqual([item.donation, item.donationText], [null, "cake"]);

    item = await patch({ donation: 3 });
    assert.deepEqual([item.donation, item.donationText], [3, null], "an amount clears the words");

    item = await patch({ donationText: "a beer" });
    assert.deepEqual([item.donation, item.donationText], [null, "a beer"], "words clear the amount");

    item = await patch({ donation: null, donationText: null });
    assert.deepEqual([item.donation, item.donationText], [null, null]);

    assert.equal((await api(app, "PATCH", `/api/items/${id}`, { token: owner.token, body: { donation: 2, donationText: "tea" } })).status, 400);
    assert.deepEqual([(await read(app, owner.token, id)).donation, (await read(app, owner.token, id)).donationText], [null, null], "a refused update changes nothing");
  });
});

test("donation text: it shows in the group list and my items", async () => {
  await withApp(async (app) => {
    const { owner, friend, group } = await setup(app);
    await makeItem(app, owner, [group.id], { donationText: "a beer" });
    const list = await ok(app, "GET", `/api/groups/${group.id}/items`, { token: friend.token });
    assert.equal(list.items[0].donationText, "a beer");
    const mine = await ok(app, "GET", "/api/items/mine", { token: owner.token });
    assert.equal(mine.items[0].donationText, "a beer");
  });
});
