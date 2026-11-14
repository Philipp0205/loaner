import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { START, TINY_PNG, api, ok, signUp, withApp, type AppCtx, type Person } from "./http.js";

// A fake value, long enough to pass the 32 character minimum.
const ADMIN = "fake-admin-token-for-tests-0123456789abcdef";
const OTHER = "another-fake-token-for-tests-0123456789ab";
const env = { FEEDBACK_ADMIN_TOKEN: ADMIN };
const admin = { token: ADMIN };

type Row = Record<string, unknown>;
const row = (app: AppCtx, id: string) => app.db.prepare("SELECT * FROM feedback WHERE id = ?").get(id) as Row;
const send = (app: AppCtx, who: Person | null, body: unknown, status = 201) =>
  ok(app, "POST", "/api/feedback", { token: who?.token, body, status });

test("feedback is stored with sender, name, version, user agent, time and status new", async () => {
  await withApp(async (app) => {
    const ann = await signUp(app, "Ann");
    const res = await fetch(`http://127.0.0.1:${app.port}/api/feedback`, {
      method: "POST",
      headers: { authorization: `Bearer ${ann.token}`, "content-type": "application/json", "user-agent": "TestPhone/1.0" },
      body: JSON.stringify({ text: "  Love it.\r\nMore dark mode please.  ", appVersion: "2026-11-14-send-feedback" }),
    });
    assert.equal(res.status, 201);
    const { id } = (await res.json()) as { id: string };
    assert.match(id, /^[\w-]+$/);
    const stored = row(app, id);
    assert.equal(stored.user_id, ann.id);
    assert.equal(stored.display_name, "Ann");
    assert.equal(stored.text, "Love it.\nMore dark mode please.");
    assert.equal(stored.app_version, "2026-11-14-send-feedback");
    assert.equal(stored.user_agent, "TestPhone/1.0");
    assert.equal(stored.created_at, START);
    assert.equal(stored.status, "new");
    assert.equal(stored.photo, null);
  });
});

test("the name is kept as it was when sent, and odd versions and long user agents are cleaned", async () => {
  await withApp(async (app) => {
    const ann = await signUp(app, "Ann");
    const first = await send(app, ann, { text: "one" });
    await ok(app, "PATCH", "/api/me", { token: ann.token, body: { name: "Anna" } });
    const second = await send(app, ann, { text: "two", appVersion: "v".repeat(200) });
    assert.equal(row(app, first.id).display_name, "Ann");
    assert.equal(row(app, second.id).display_name, "Anna");
    assert.equal(row(app, first.id).app_version, null);
    assert.equal((row(app, second.id).app_version as string).length, 64);
    const long = await fetch(`http://127.0.0.1:${app.port}/api/feedback`, {
      method: "POST",
      headers: { authorization: `Bearer ${ann.token}`, "content-type": "application/json", "user-agent": "x".repeat(900) },
      body: JSON.stringify({ text: "ua", appVersion: 7 }),
    });
    const stored = row(app, ((await long.json()) as { id: string }).id);
    assert.equal((stored.user_agent as string).length, 200);
    assert.equal(stored.app_version, null);
  });
});

test("text must be 1 to 2000 characters after trimming, and a sign-in is required", async () => {
  await withApp(async (app) => {
    const ann = await signUp(app, "Ann");
    for (const text of ["", "   \n\t ", "x".repeat(2001), `  ${"x".repeat(2001)}  `, 7, null, undefined]) {
      const res = await api(app, "POST", "/api/feedback", { token: ann.token, body: { text } });
      assert.equal(res.status, 400, String(text).slice(0, 8));
    }
    assert.equal((await api(app, "POST", "/api/feedback", { token: ann.token, body: {} })).status, 400);
    await send(app, ann, { text: "y".repeat(2000) });
    await send(app, ann, { text: `  ${"z".repeat(2000)}  ` });
    assert.equal((await api(app, "POST", "/api/feedback", { body: { text: "hi" } })).status, 401);
    assert.equal((await api(app, "POST", "/api/feedback", { token: "nope", body: { text: "hi" } })).status, 401);
    assert.equal(Number((app.db.prepare("SELECT COUNT(*) AS n FROM feedback").get() as { n: number }).n), 2);
  });
});

test("ten sends per person per hour, then 429, and the clock lets it reset", async () => {
  await withApp(async (app) => {
    const ann = await signUp(app, "Ann");
    const bob = await signUp(app, "Bob");
    for (let i = 0; i < 10; i += 1) await send(app, ann, { text: `n${i}` });
    assert.equal((await api(app, "POST", "/api/feedback", { token: ann.token, body: { text: "eleven" } })).status, 429);
    // Another person has their own allowance. Invalid text does not use one up.
    for (let i = 0; i < 12; i += 1) assert.equal((await api(app, "POST", "/api/feedback", { token: bob.token, body: { text: " " } })).status, 400);
    await send(app, bob, { text: "mine" });
    app.advance(59 * 60 * 1000);
    assert.equal((await api(app, "POST", "/api/feedback", { token: ann.token, body: { text: "still" } })).status, 429);
    app.advance(60 * 1000);
    await send(app, ann, { text: "later" });
    assert.equal(Number((app.db.prepare("SELECT COUNT(*) AS n FROM feedback").get() as { n: number }).n), 12);
  });
});

test("an attached photo is stored for the sender only, and the list shows hasPhoto, never bytes", async () => {
  await withApp(async (app) => {
    const ann = await signUp(app, "Ann");
    const bob = await signUp(app, "Bob");
    const { id } = await send(app, ann, { text: "see the screenshot" });
    const put = (who: Person | null, bytes: Buffer, contentType = "image/png") =>
      api(app, "PUT", `/api/feedback/${id}/photo`, { token: who?.token, raw: bytes, contentType });
    assert.equal((await put(null, TINY_PNG)).status, 401);
    assert.equal((await put(bob, TINY_PNG)).status, 404, "not someone else's feedback");
    assert.equal((await put(ann, TINY_PNG, "text/plain")).status, 415);
    assert.equal((await put(ann, Buffer.from("not a png"))).status, 415, "bytes must match the type");
    assert.equal((await put(ann, Buffer.alloc(0))).status, 400);
    assert.equal((await put(ann, TINY_PNG)).status, 200);
    assert.equal((await put(ann, TINY_PNG)).status, 409, "only one photo");
    assert.equal((await api(app, "PUT", "/api/feedback/missing/photo", { token: ann.token, raw: TINY_PNG, contentType: "image/png" })).status, 404);

    const list = await ok(app, "GET", "/api/admin/feedback", admin);
    assert.equal(list.feedback[0].hasPhoto, true);
    assert.equal("photo" in list.feedback[0], false);
    const bytes = await api(app, "GET", `/api/admin/feedback/${id}/photo`, admin);
    assert.equal(bytes.status, 200);
    assert.equal(bytes.type, "image/png");
    assert.ok(bytes.bytes.equals(TINY_PNG));
    assert.equal((await api(app, "GET", `/api/admin/feedback/${id}/photo`, { token: ann.token })).status, 404);
    const plain = await send(app, ann, { text: "no photo" });
    assert.equal((await api(app, "GET", `/api/admin/feedback/${plain.id}/photo`, admin)).status, 404);
    assert.equal((await ok(app, "GET", "/api/admin/feedback", admin)).feedback[0].hasPhoto, false);
  }, { env });
});

test("admin list: newest first, the documented fields, no photo bytes", async () => {
  await withApp(async (app) => {
    const ann = await signUp(app, "Ann");
    const bob = await signUp(app, "Bob");
    app.at(START + 1000);
    const a = await send(app, ann, { text: "first", appVersion: "v1" });
    app.at(START + 2000);
    const b = await send(app, bob, { text: "second" });
    app.at(START + 2000);
    const c = await send(app, ann, { text: "third" });
    const { feedback } = await ok(app, "GET", "/api/admin/feedback", admin);
    assert.deepEqual(feedback.map((f: Row) => f.id), [c.id, b.id, a.id]);
    assert.deepEqual(Object.keys(feedback[2]).sort(), ["appVersion", "createdAt", "displayName", "hasPhoto", "id", "status", "text", "userAgent", "userId"]);
    assert.equal(feedback[2].userId, ann.id);
    assert.equal(feedback[2].displayName, "Ann");
    assert.equal(feedback[2].text, "first");
    assert.equal(feedback[2].appVersion, "v1");
    assert.equal(feedback[2].createdAt, START + 1000);
    assert.equal(feedback[2].status, "new");
    assert.equal(feedback[2].hasPhoto, false);
  }, { env });
});

test("admin list: since filters on created_at, a missing since is capped at 200, a bad since is 400", async () => {
  await withApp(async (app) => {
    const ann = await signUp(app, "Ann");
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      app.at(START + i * 1000);
      ids.push((await send(app, ann, { text: `m${i}` })).id);
    }
    const since = (value: string) => api(app, "GET", `/api/admin/feedback?since=${encodeURIComponent(value)}`, admin);
    const list = async (value: string) => ((await since(value)).json.feedback as Row[]).map((f) => f.id);
    assert.deepEqual(await list(new Date(START).toISOString()), [ids[2], ids[1]], "strictly after");
    assert.deepEqual(await list(new Date(START - 1).toISOString()), [ids[2], ids[1], ids[0]]);
    assert.deepEqual(await list(new Date(START + 2000).toISOString()), []);
    assert.deepEqual(await list("2026-06-01"), [ids[2], ids[1], ids[0]], "a plain date is midnight UTC");
    assert.deepEqual(await list("2026-06-02"), []);
    assert.deepEqual(await list("2026-06-01T15:00:00+00:00"), [ids[2], ids[1]]);
    assert.equal(((await api(app, "GET", "/api/admin/feedback?since=", admin)).json.feedback as Row[]).length, 3);
    for (const bad of ["yesterday", "2026-13-45", "123", "2026-06-01T25:99", "'; DROP TABLE feedback"]) {
      assert.equal((await since(bad)).status, 400, bad);
    }

    for (let i = 0; i < 210; i += 1) {
      app.db.prepare("INSERT INTO feedback (id, user_id, display_name, text, created_at) VALUES (?, ?, 'Ann', 'bulk', ?)").run(`bulk${i}`, ann.id, START + 10_000 + i);
    }
    const capped = (await ok(app, "GET", "/api/admin/feedback", admin)).feedback as Row[];
    assert.equal(capped.length, 200);
    assert.equal(capped[0].id, "bulk209");
  }, { env });
});

test("admin PATCH sets one of the three statuses and returns the row", async () => {
  await withApp(async (app) => {
    const ann = await signUp(app, "Ann");
    const { id } = await send(app, ann, { text: "please" });
    for (const status of ["seen", "done", "new"]) {
      const res = await ok(app, "PATCH", `/api/admin/feedback/${id}`, { ...admin, body: { status } });
      assert.equal(res.feedback.status, status);
      assert.equal(row(app, id).status, status);
      assert.equal(res.feedback.text, "please");
    }
    for (const body of [{ status: "planned" }, { status: "DONE" }, { status: "" }, { status: 3 }, { status: null }, {}]) {
      const res = await api(app, "PATCH", `/api/admin/feedback/${id}`, { ...admin, body });
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    assert.equal(row(app, id).status, "new");
    assert.equal((await api(app, "PATCH", "/api/admin/feedback/nope", { ...admin, body: { status: "done" } })).status, 404);
  }, { env });
});

test("admin routes answer 404 when FEEDBACK_ADMIN_TOKEN is unset, blank, or the wrong method is used", async () => {
  for (const options of [{}, { env: { FEEDBACK_ADMIN_TOKEN: "" } }, { env: { FEEDBACK_ADMIN_TOKEN: "   " } }]) {
    await withApp(async (app) => {
      const ann = await signUp(app, "Ann");
      const { id } = await send(app, ann, { text: "hi" });
      for (const token of [ADMIN, "", ann.token]) {
        assert.equal((await api(app, "GET", "/api/admin/feedback", { token: token || undefined })).status, 404);
        assert.equal((await api(app, "PATCH", `/api/admin/feedback/${id}`, { token: token || undefined, body: { status: "done" } })).status, 404);
      }
      assert.equal(row(app, id).status, "new");
    }, options);
  }
  await withApp(async (app) => {
    assert.equal((await api(app, "POST", "/api/admin/feedback", admin)).status, 404);
    assert.equal((await api(app, "DELETE", "/api/admin/feedback/x", admin)).status, 404);
  }, { env });
});

test("with a token set, a missing or wrong bearer is 404 too, and a user device token is not admin", async () => {
  await withApp(async (app) => {
    const ann = await signUp(app, "Ann");
    const { id } = await send(app, ann, { text: "hi" });
    const bodies = { body: { status: "done" } };
    const tries: Array<[string, string | undefined]> = [["none", undefined], ["wrong", OTHER], ["short", "x"], ["prefix", ADMIN.slice(0, -1)], ["longer", `${ADMIN}x`], ["device token", ann.token]];
    for (const [label, token] of tries) {
      const list = await api(app, "GET", "/api/admin/feedback", { token });
      assert.equal(list.status, 404, label);
      assert.deepEqual(list.json, { error: "not found" }, label);
      assert.equal((await api(app, "PATCH", `/api/admin/feedback/${id}`, { token, ...bodies })).status, 404, label);
      assert.equal((await api(app, "GET", `/api/admin/feedback/${id}/photo`, { token })).status, 404, label);
    }
    // Same answer as a path that really does not exist, and no status change leaked through.
    assert.deepEqual((await api(app, "GET", "/api/admin/nothing", { token: OTHER })).json, { error: "not found" });
    assert.equal(row(app, id).status, "new");
    // Basic auth and a raw token without "Bearer" are not accepted either.
    const raw = await fetch(`http://127.0.0.1:${app.port}/api/admin/feedback`, { headers: { authorization: ADMIN } });
    assert.equal(raw.status, 404);
    const good = await api(app, "GET", "/api/admin/feedback", admin);
    assert.equal(good.status, 200);
    assert.equal(good.json.feedback.length, 1);
  }, { env });
});

test("the admin token is trimmed, must be 32 characters, and is never printed", async () => {
  assert.equal(loadConfig({ FEEDBACK_ADMIN_TOKEN: `  ${ADMIN}  ` }).adminToken, ADMIN);
  assert.equal(loadConfig({}).adminToken, null);
  assert.equal(loadConfig({ FEEDBACK_ADMIN_TOKEN: " \t " }).adminToken, null);
  const tooShort = "short-secret-value";
  assert.throws(
    () => loadConfig({ FEEDBACK_ADMIN_TOKEN: tooShort }),
    (error: Error) => /at least 32/.test(error.message) && !error.message.includes(tooShort),
  );
  const logged: string[] = [];
  const original = { log: console.log, error: console.error };
  console.log = (...args: unknown[]) => void logged.push(args.join(" "));
  console.error = (...args: unknown[]) => void logged.push(args.join(" "));
  try {
    await withApp(async (app) => {
      const ann = await signUp(app, "Ann");
      await api(app, "GET", "/api/admin/feedback", { token: OTHER });
      await api(app, "GET", "/api/admin/feedback", admin);
      await send(app, ann, { text: "hi" });
    }, { env });
  } finally {
    console.log = original.log;
    console.error = original.error;
  }
  assert.equal(logged.some((line) => line.includes(ADMIN) || line.includes(OTHER)), false);
});
