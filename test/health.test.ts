import assert from "node:assert/strict";
import test from "node:test";
import { api, withApp } from "./http.js";

test("health: GET /api/health is open and answers ok", async () => {
  await withApp(async (app) => {
    const res = await api(app, "GET", "/api/health");
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { ok: true });
  });
});

test("health: a wrong method on the path is 405", async () => {
  await withApp(async (app) => {
    assert.equal((await api(app, "POST", "/api/health")).status, 405);
  });
});
