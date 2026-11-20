import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { api, makeGroup, makeItem, signUp, TINY_PNG, withApp, type AppCtx } from "./http.js";

/** The header Loan some sends: everything from this origin only. No CDN, no workers, no wasm. */
const EXPECTED =
  "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self'; style-src-attr 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

/** Directive name to its sorted sources, so order does not matter but every directive and source does. */
function directives(csp: string): Record<string, string[]> {
  return Object.fromEntries(
    csp.split(/;\s*/).filter(Boolean).map((part) => {
      const [name, ...sources] = part.trim().split(/\s+/);
      return [name, sources.sort()];
    }),
  );
}

/** A raw request, so a path such as /../x reaches the server as written. fetch would tidy it first. */
function raw(app: AppCtx, method: string, path: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: app.port, method, path }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

const csp = (headers: http.IncomingHttpHeaders) => String(headers["content-security-policy"]);

test("csp: the same directives and sources, with base-uri none, on every kind of response", async () => {
  await withApp(async (app) => {
    const person = await signUp(app, "Pat");
    const photoItem = await (async () => {
      const group = await makeGroup(app, person, "Group");
      const id = await makeItem(app, person, [group.id]);
      await api(app, "PUT", `/api/items/${id}/photo`, { token: person.token, raw: TINY_PNG, contentType: "image/png" });
      return id;
    })();
    const responses = [
      await raw(app, "GET", "/api/health"),
      await raw(app, "GET", "/api/config"),
      await raw(app, "GET", "/api/nope"),
      await raw(app, "POST", "/api/health"),
      await raw(app, "GET", "/"),
      await raw(app, "GET", "/join/ABC"),
      await raw(app, "GET", "/app.js"),
      await raw(app, "GET", "/missing.js"),
      await raw(app, "POST", "/"),
      await raw(app, "GET", `/api/items/${photoItem}/photo`),
    ];
    for (const res of responses) {
      assert.deepEqual(directives(csp(res.headers)), directives(EXPECTED), `${res.status} ${res.headers["content-type"]}`);
      assert.match(csp(res.headers), /base-uri 'none'/);
    }
  });
});

test("csp: scripts and fetches come from this origin only, with no CDN, model host, worker or wasm", async () => {
  await withApp(async (app) => {
    const { headers } = await raw(app, "GET", "/");
    const header = csp(headers);
    const policy = directives(header);
    assert.deepEqual(policy["script-src"], ["'self'"]);
    assert.deepEqual(policy["connect-src"], ["'self'"]);
    assert.equal(policy["worker-src"], undefined, "no worker-src, so workers fall back to default-src 'self'");
    assert.doesNotMatch(header, /jsdelivr|huggingface|hf\.co|wasm-unsafe-eval|https?:/);
    assert.deepEqual(policy["base-uri"], ["'none'"]);
    assert.deepEqual(policy["frame-ancestors"], ["'none'"]);
  });
});

test("headers: JSON is no-store, static files are no-cache, photos are private no-cache", async () => {
  await withApp(async (app) => {
    const person = await signUp(app, "Pat");
    const group = await makeGroup(app, person, "Group");
    const id = await makeItem(app, person, [group.id]);
    await api(app, "PUT", `/api/items/${id}/photo`, { token: person.token, raw: TINY_PNG, contentType: "image/png" });

    const json = await raw(app, "GET", "/api/config");
    assert.equal(json.headers["cache-control"], "no-store");
    assert.match(String(json.headers["content-type"]), /^application\/json/);
    const error = await raw(app, "GET", "/api/nope");
    assert.equal(error.status, 404);
    assert.equal(error.headers["cache-control"], "no-store");
    for (const file of ["/", "/app", "/join/ABC", "/app.js", "/css/tokens.css", "/sw.js", "/og.png"]) {
      const res = await raw(app, "GET", file);
      assert.equal(res.status, 200, file);
      assert.equal(res.headers["cache-control"], "no-cache", file);
    }
    const photo = await fetch(`http://127.0.0.1:${app.port}/api/items/${id}/photo`, { headers: { authorization: `Bearer ${person.token}` } });
    assert.equal(photo.status, 200);
    assert.equal(photo.headers.get("cache-control"), "private, no-cache");
    assert.equal(photo.headers.get("content-type"), "image/png");
    for (const res of [json, error]) {
      assert.equal(res.headers["x-content-type-options"], "nosniff");
      assert.equal(res.headers["referrer-policy"], "no-referrer");
      assert.equal(res.headers["x-frame-options"], "DENY");
    }
  });
});

test("static: the app shell for app routes, the right types, GET and HEAD, nothing outside public", async () => {
  await withApp(async (app) => {
    const home = await raw(app, "GET", "/");
    assert.equal(home.status, 200);
    assert.match(String(home.headers["content-type"]), /^text\/html/);
    assert.equal(home.headers["cache-control"], "no-cache");
    assert.match(home.body, /<title>Loan some: lend things to your friends<\/title>/);
    assert.match(home.body, /<script src="\/landing\.js"><\/script>/);

    const join = await raw(app, "GET", "/join/ABC");
    assert.equal(join.status, 200);
    assert.match(String(join.headers["content-type"]), /^text\/html/);
    assert.match(join.body, /<title>Loan some<\/title>/);
    assert.notEqual(join.body, home.body, "the home page and the app shell are different documents");
    const shell = await raw(app, "GET", "/app");
    assert.equal(shell.status, 200);
    assert.equal(shell.body, join.body, "an extensionless app route serves index.html");
    assert.equal((await raw(app, "GET", "/landing.html")).body, home.body);
    for (const file of ["/welcome", "/welcome/"]) {
      const welcome = await raw(app, "GET", file);
      assert.equal(welcome.status, 200, file);
      assert.match(String(welcome.headers["content-type"]), /^text\/html/, file);
      assert.equal(welcome.body, home.body, `${file} serves the home page, not the app shell`);
      assert.notEqual(welcome.body, shell.body, file);
    }
    assert.match(home.body, /<link rel="canonical" href="https:\/\/www\.loanso\.me\/">/, "the canonical stays the root");

    const types: Record<string, RegExp> = {
      "/app.js": /^text\/javascript/,
      "/css/tokens.css": /^text\/css/,
      "/manifest.webmanifest": /^application\/manifest\+json/,
      "/fonts/inter-latin-var.woff2": /^font\/woff2/,
      "/icons/icon-192.png": /^image\/png/,
      "/logo.svg": /^image\/svg\+xml/,
    };
    for (const [file, type] of Object.entries(types)) {
      const res = await raw(app, "GET", file);
      assert.equal(res.status, 200, file);
      assert.match(String(res.headers["content-type"]), type, file);
    }

    const head = await raw(app, "HEAD", "/app.js");
    assert.equal(head.status, 200);
    assert.equal(head.body, "");
    assert.ok(Number(head.headers["content-length"]) > 0);

    assert.equal((await raw(app, "POST", "/")).status, 405);
    assert.equal((await raw(app, "PUT", "/app.js")).status, 405);
    assert.equal((await raw(app, "GET", "/missing.js")).status, 404);
    for (const bad of ["/../package.json", "/css/../../package.json", "/%2e%2e/package.json", "/%00.js", "/%E0%A4%A", "/app.js%00.png"]) {
      const res = await raw(app, "GET", bad);
      assert.ok([400, 404].includes(res.status), `${bad} is ${res.status}`);
      assert.doesNotMatch(res.body, /"name": "loaner"/, bad);
    }
  });
});

test("uploads: a body over the cap is a 413 with the Loan some message", async () => {
  await withApp(async (app) => {
    const person = await signUp(app, "Pat");
    const big = await api(app, "POST", "/api/groups", { token: person.token, body: { name: "x".repeat(20 * 1024) } });
    assert.equal(big.status, 413);
    assert.equal(big.json.error, "that upload is too large");
  });
});
