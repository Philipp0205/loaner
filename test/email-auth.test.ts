import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { MailerError } from "../src/app-kit/index.ts";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db.js";
import { createMailer } from "../src/mail.js";
import { api, emailFor, flush, linkToken, makeGroup, ok, seedLegacyUser, signUp, withApp } from "./http.js";

// A fake key. It never reaches a real server: every test either has no key or injects a fake fetch.
const FAKE_KEY = "re_test_not_a_real_key";
const MINUTE = 60_000;

const start = (app: { port: number }, body: unknown) => api(app, "POST", "/api/auth/start", { body });

test("email: sign-up needs a plausible address and says so before it creates anyone", async () => {
  await withApp(async (app) => {
    for (const email of [undefined, "", "   ", "nope", "a@b", "a b@c.de", "a@@c.de", 5, null]) {
      const res = await start(app, { name: "Alice", email });
      assert.equal(res.status, 400, `email ${JSON.stringify(email)}`);
      assert.match(res.json.error, /email/);
    }
    assert.equal((app.db.prepare("SELECT COUNT(*) AS n FROM users").get() as any).n, 0, "nothing was created");
    assert.equal(app.mail.sent.length, 0);
  });
});

test("email: sign-up stores the address lowercased and unverified, and mails a verify link without the recovery code", async () => {
  await withApp(async (app) => {
    const res = await start(app, { name: "Alice", email: "  Alice@Example.COM " });
    assert.equal(res.status, 200);
    assert.equal(res.json.user.email, "alice@example.com");
    assert.equal(res.json.user.emailVerifiedAt, null);
    assert.equal(res.json.user.needsEmail, false);
    const row = app.db.prepare("SELECT email, email_verified_at FROM users").get() as any;
    assert.equal(row.email, "alice@example.com");
    assert.equal(row.email_verified_at, null);
    assert.equal(app.mail.sent.length, 1);
    const [mail] = app.mail.sent;
    assert.equal(mail.to, "alice@example.com");
    assert.match(mail.text, /\/verify#t=/);
    assert.ok(mail.text.startsWith("Confirm your email address for Loan some"));
    assert.ok(!mail.text.includes(res.json.recoveryCode) && !mail.html.includes(res.json.recoveryCode), "the recovery code is never mailed");
    const stored = JSON.stringify(app.db.prepare("SELECT * FROM auth_links").all());
    assert.ok(!stored.includes(linkToken(mail, "verify")), "only the hash of the link token is stored");
  });
});

test("email: a failing mail provider does not fail sign-up and its error never leaks a link or address into the log", async () => {
  const logged: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
  try {
    await withApp(
      async (app) => {
        const res = await start(app, { name: "Alice", email: "alice@example.com" });
        assert.equal(res.status, 200, "sign-up still works");
        assert.ok(logged.length >= 1, "the failure is logged");
        for (const line of logged) {
          assert.ok(!line.includes("#t="), line);
          assert.ok(!line.includes("alice@example.com"), line);
          assert.ok(!line.includes("provider-secret-detail"), line);
        }
      },
      {
        mailer: {
          async send() {
            throw new Error("provider-secret-detail alice@example.com");
          },
        },
      },
    );
  } finally {
    console.error = original;
  }
});

test("email: an invite is still checked first, so a bad link with a good email creates nothing", async () => {
  await withApp(async (app) => {
    const res = await start(app, { name: "Carol", email: "carol@example.com", inviteCode: "NOPENOPE12" });
    assert.equal(res.status, 404);
    assert.equal((app.db.prepare("SELECT COUNT(*) AS n FROM users").get() as any).n, 0);
    assert.equal(app.mail.sent.length, 0, "no mail for an account that was never made");
  });
});

test("email: an account from before email was required gets 403 on ordinary routes until it adds one", async () => {
  await withApp(async (app) => {
    const lena = seedLegacyUser(app, "Lena");
    const me = await ok(app, "GET", "/api/me", { token: lena.token });
    assert.equal(me.user.needsEmail, true);
    assert.equal(me.user.email, null);
    for (const [method, route] of [["GET", "/api/groups"], ["POST", "/api/groups"], ["GET", "/api/notifications"], ["PATCH", "/api/me"]] as const) {
      const res = await api(app, method, route, { token: lena.token, body: method === "GET" ? undefined : { name: "x" } });
      assert.equal(res.status, 403, `${method} ${route}`);
      assert.equal(res.json.error, "add an email first");
    }
    assert.equal((await api(app, "GET", "/api/me")).status, 401, "no token is still a 401");

    const saved = await ok(app, "PUT", "/api/me/email", { token: lena.token, body: { email: "Lena@Example.com" } });
    assert.equal(saved.user.email, "lena@example.com");
    assert.equal(saved.user.emailVerifiedAt, null, "adding an address does not verify it");
    assert.equal(app.mail.sent.length, 1);
    assert.equal(app.mail.sent[0].to, "lena@example.com");
    assert.equal((await api(app, "GET", "/api/groups", { token: lena.token })).status, 200, "the gate is open once an address is saved");
  });
});

test("email: a legacy account signs in with its recovery code, is told it needs an email, and can sign out", async () => {
  await withApp(async (app) => {
    const lena = seedLegacyUser(app, "Lena");
    const res = await ok(app, "POST", "/api/auth/recover", { body: { code: lena.code } });
    assert.equal(res.user.needsEmail, true);
    assert.equal((await api(app, "GET", "/api/groups", { token: res.token })).status, 403);
    assert.equal((await api(app, "POST", "/api/auth/logout", { token: res.token })).status, 200);
    assert.equal((await api(app, "GET", "/api/me", { token: res.token })).status, 401);
  });
});

test("email: a legacy account cannot join by invite until it adds an email, then the join works", async () => {
  await withApp(async (app) => {
    const host = await signUp(app, "Hana");
    const group = await makeGroup(app, host, "Flat 3B");
    const lena = seedLegacyUser(app, "Lena");

    const refused = await api(app, "POST", `/api/invites/${group.inviteCode}/join`, { token: lena.token });
    assert.equal(refused.status, 403);
    assert.equal(refused.json.error, "add an email first");
    assert.equal((app.db.prepare("SELECT COUNT(*) AS n FROM memberships WHERE user_id = ?").get(lena.id) as any).n, 0, "not a member yet");

    await ok(app, "PUT", "/api/me/email", { token: lena.token, body: { email: "lena@example.com" } });
    const joined = await ok(app, "POST", `/api/invites/${group.inviteCode}/join`, { token: lena.token });
    assert.equal(joined.group.id, group.id);
    const groups = await ok(app, "GET", "/api/groups", { token: lena.token });
    assert.deepEqual(groups.groups.map((g: any) => g.id), [group.id]);
  });
});

test("email: /api/me reports the email and, once the link is used, emailVerifiedAt (what the banner poll reads)", async () => {
  await withApp(async (app) => {
    const alice = await signUp(app, "Alice");
    const before = await ok(app, "GET", "/api/me", { token: alice.token });
    assert.equal(before.user.email, alice.email);
    assert.equal(before.user.emailVerifiedAt, null);

    await ok(app, "POST", "/api/auth/verify", { body: { token: linkToken(app.mail.sent[0], "verify") } });
    const after = await ok(app, "GET", "/api/me", { token: alice.token });
    assert.equal(after.user.email, alice.email);
    assert.equal(after.user.emailVerifiedAt, app.ctx.now());
  });
});

test("email: the setEmail routes reject a bad address and need a session", async () => {
  await withApp(async (app) => {
    const alice = await signUp(app, "Alice");
    for (const method of ["PUT", "POST"]) {
      assert.equal((await api(app, method, "/api/me/email", { token: alice.token, body: { email: "nope" } })).status, 400);
      assert.equal((await api(app, method, "/api/me/email", { body: { email: "a@b.cd" } })).status, 401);
    }
    assert.equal((await api(app, "GET", "/api/me/email", { token: alice.token })).status, 405);
  });
});

test("verify: the link page is served on GET without using the token, and a POST uses it exactly once", async () => {
  await withApp(async (app) => {
    const alice = await signUp(app, "Alice");
    const token = linkToken(app.mail.sent[0], "verify");

    const page = await fetch(`http://127.0.0.1:${app.port}/verify`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type") ?? "", /html/);
    assert.match(await page.text(), /id="root"/);
    assert.equal((await api(app, "GET", `/api/auth/verify?t=${token}`)).status, 405, "no GET consumes a token");
    assert.equal((app.db.prepare("SELECT COUNT(*) AS n FROM auth_links").get() as any).n, 1, "the link is still there");

    assert.deepEqual(await ok(app, "POST", "/api/auth/verify", { body: { token } }), { ok: true });
    const me = await ok(app, "GET", "/api/me", { token: alice.token });
    assert.equal(me.user.emailVerifiedAt, app.ctx.now());
    assert.equal((await api(app, "POST", "/api/auth/verify", { body: { token } })).status, 400, "single use");
  });
});

test("verify: unknown, empty and expired tokens are a 400", async () => {
  await withApp(async (app) => {
    await signUp(app, "Alice");
    const token = linkToken(app.mail.sent[0], "verify");
    for (const bad of ["", "nope", "A".repeat(43)]) {
      assert.equal((await api(app, "POST", "/api/auth/verify", { body: { token: bad } })).status, 400, JSON.stringify(bad));
    }
    assert.equal((await api(app, "POST", "/api/auth/verify", { body: {} })).status, 400);
    app.advance(25 * 60 * MINUTE);
    assert.equal((await api(app, "POST", "/api/auth/verify", { body: { token } })).status, 400, "a verify link lives 24 hours");
  });
});

test("verify: a fresh link replaces the old one, and changing the address kills the link for the old one", async () => {
  await withApp(async (app) => {
    const alice = await signUp(app, "Alice");
    const first = linkToken(app.mail.sent[0], "verify");
    await ok(app, "POST", "/api/me/email", { token: alice.token, body: { email: alice.email } });
    assert.equal(app.mail.sent.length, 2, "send again mails a new link");
    const second = linkToken(app.mail.sent[1], "verify");
    assert.notEqual(first, second);
    assert.equal((await api(app, "POST", "/api/auth/verify", { body: { token: first } })).status, 400, "only one live link");

    await ok(app, "PUT", "/api/me/email", { token: alice.token, body: { email: "alice2@example.com" } });
    assert.equal((await api(app, "POST", "/api/auth/verify", { body: { token: second } })).status, 400, "the old address cannot be confirmed any more");
    const third = linkToken(app.mail.sent[2], "verify");
    assert.equal(app.mail.sent[2].to, "alice2@example.com");
    assert.equal((await api(app, "POST", "/api/auth/verify", { body: { token: third } })).status, 200);
  });
});

test("verify: the same verified address again is a no-op, a new address needs confirming again", async () => {
  await withApp(async (app) => {
    const alice = await signUp(app, "Alice");
    await ok(app, "POST", "/api/auth/verify", { body: { token: linkToken(app.mail.sent[0], "verify") } });
    const again = await ok(app, "PUT", "/api/me/email", { token: alice.token, body: { email: alice.email } });
    assert.ok(again.user.emailVerifiedAt, "still verified");
    assert.equal(app.mail.sent.length, 1, "no new mail");

    const changed = await ok(app, "PUT", "/api/me/email", { token: alice.token, body: { email: "other@example.com" } });
    assert.equal(changed.user.emailVerifiedAt, null);
    assert.equal(app.mail.sent.length, 2);
  });
});

test("verify: two people may hold the same unverified address, but only the first to confirm keeps it", async () => {
  await withApp(async (app) => {
    const alice = await signUp(app, "Alice", undefined, "shared@example.com");
    const bob = await signUp(app, "Bob", undefined, "shared@example.com");
    assert.notEqual(alice.id, bob.id);
    const [forAlice, forBob] = app.mail.sent;
    assert.deepEqual(await ok(app, "POST", "/api/auth/verify", { body: { token: linkToken(forAlice, "verify") } }), { ok: true });
    const res = await api(app, "POST", "/api/auth/verify", { body: { token: linkToken(forBob, "verify") } });
    assert.equal(res.status, 409);
    assert.match(res.json.error, /already used/);
    const bobMe = await ok(app, "GET", "/api/me", { token: bob.token });
    assert.equal(bobMe.user.emailVerifiedAt, null);
  });
});

test("lost code: the answer is the same for a missing, unknown, unverified and verified address, and only a verified one gets mail", async () => {
  await withApp(async (app) => {
    await signUp(app, "Unverified");
    const verified = await signUp(app, "Verified");
    await ok(app, "POST", "/api/auth/verify", { body: { token: linkToken(app.mail.sent[1], "verify") } });
    const before = app.mail.sent.length;

    const answers = [];
    for (const email of [undefined, "", "nope", "ghost@example.com", emailFor("Unverified"), emailFor("Verified")]) {
      const res = await api(app, "POST", "/api/auth/lost-code", { body: { email } });
      answers.push([res.status, JSON.stringify(res.json)]);
    }
    assert.deepEqual(new Set(answers.map((a) => a.join(" "))), new Set(['200 {"ok":true}']), "one answer for all of them");
    await flush();
    const sent = app.mail.sent.slice(before);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, verified.email);
    assert.match(sent[0].text, /\/recover#t=/);
    assert.ok(!sent[0].text.includes(verified.code), "the recovery code is never mailed");
  });
});

test("lost code: the link signs in once, rotates the recovery code, and the old code stops working", async () => {
  await withApp(async (app) => {
    const alice = await signUp(app, "Alice");
    await ok(app, "POST", "/api/auth/verify", { body: { token: linkToken(app.mail.sent[0], "verify") } });
    await ok(app, "POST", "/api/auth/lost-code", { body: { email: alice.email } });
    await flush();
    const token = linkToken(app.mail.sent[1], "recover");

    const page = await fetch(`http://127.0.0.1:${app.port}/recover`);
    assert.equal(page.status, 200);
    assert.equal((await api(app, "GET", `/api/auth/lost-code/consume?t=${token}`)).status, 405, "a GET never uses the link");

    const res = await ok(app, "POST", "/api/auth/lost-code/consume", { body: { token } });
    assert.equal(res.user.id, alice.id);
    assert.match(res.recoveryCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.notEqual(res.recoveryCode, alice.code);
    assert.equal((await ok(app, "GET", "/api/me", { token: res.token })).user.id, alice.id, "the new session works");
    assert.equal((await api(app, "POST", "/api/auth/recover", { body: { code: alice.code } })).status, 401, "the old code is dead");
    assert.equal((await api(app, "POST", "/api/auth/recover", { body: { code: res.recoveryCode } })).status, 200);
    assert.equal((await api(app, "POST", "/api/auth/lost-code/consume", { body: { token } })).status, 400, "single use");
    assert.equal((await api(app, "GET", "/api/me", { token: alice.token })).status, 200, "other phones stay signed in");
  });
});

test("lost code: the link expires after 20 minutes, and verify and recover tokens do not swap", async () => {
  await withApp(async (app) => {
    const alice = await signUp(app, "Alice");
    const verifyToken = linkToken(app.mail.sent[0], "verify");
    await ok(app, "POST", "/api/auth/verify", { body: { token: verifyToken } });
    await ok(app, "POST", "/api/auth/lost-code", { body: { email: alice.email } });
    await flush();
    const recoverToken = linkToken(app.mail.sent[1], "recover");

    assert.equal((await api(app, "POST", "/api/auth/lost-code/consume", { body: { token: verifyToken } })).status, 400);
    assert.equal((await api(app, "POST", "/api/auth/verify", { body: { token: recoverToken } })).status, 400);

    app.advance(21 * MINUTE);
    assert.equal((await api(app, "POST", "/api/auth/lost-code/consume", { body: { token: recoverToken } })).status, 400, "20 minutes is the limit");
    assert.equal((await api(app, "POST", "/api/auth/lost-code/consume", { body: { token: "" } })).status, 400);
  });
});

test("lost code: asking for a new link makes the older one useless", async () => {
  await withApp(async (app) => {
    const alice = await signUp(app, "Alice");
    await ok(app, "POST", "/api/auth/verify", { body: { token: linkToken(app.mail.sent[0], "verify") } });
    await ok(app, "POST", "/api/auth/lost-code", { body: { email: alice.email } });
    await flush();
    await ok(app, "POST", "/api/auth/lost-code", { body: { email: alice.email } });
    await flush();
    const [, first, second] = app.mail.sent.map((m) => m.text);
    const old = /recover#t=([A-Za-z0-9_-]+)/.exec(first)![1];
    const fresh = /recover#t=([A-Za-z0-9_-]+)/.exec(second)![1];
    assert.equal((await api(app, "POST", "/api/auth/lost-code/consume", { body: { token: old } })).status, 400);
    assert.equal((await api(app, "POST", "/api/auth/lost-code/consume", { body: { token: fresh } })).status, 200);
  });
});

test("lost code: requests are rate limited per client and answer 429", async () => {
  await withApp(async (app) => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) statuses.push((await api(app, "POST", "/api/auth/lost-code", { body: { email: "ghost@example.com" } })).status);
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(200));
    assert.equal(statuses[10], 429);
    assert.equal(statuses[11], 429);
  });
});

test("lost code: with no mailer nothing is sent and the answer does not change", async () => {
  // The default mailer is Resend only when a key is set. Without one the kit sends nothing.
  const { createApp } = await import("../src/app.js");
  const http = await import("node:http");
  const { createNoopPushSender } = await import("../src/push.js");
  const db = openDb(":memory:");
  const config = loadConfig({ PORT: "3000", DB_PATH: ":memory:", APP_TZ: "UTC" });
  const server = http.createServer(createApp({ db, config, push: createNoopPushSender(), now: () => Date.now() }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  try {
    const app = { port: (server.address() as import("node:net").AddressInfo).port };
    const alice = await signUp(app, "Alice");
    const res = await api(app, "POST", "/api/auth/lost-code", { body: { email: alice.email } });
    assert.deepEqual([res.status, res.json], [200, { ok: true }]);
    assert.equal((await api(app, "GET", "/api/me", { token: alice.token })).status, 200, "sign-up works without mail");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
});

test("pages: /verify and /recover are the app shell, / and /welcome stay the home page", async () => {
  await withApp(async (app) => {
    const text = async (route: string) => {
      const res = await fetch(`http://127.0.0.1:${app.port}${route}`);
      assert.equal(res.status, 200, route);
      return res.text();
    };
    for (const route of ["/verify", "/recover", "/app"]) assert.match(await text(route), /src="\/app\.js"/, route);
    for (const route of ["/", "/welcome"]) assert.doesNotMatch(await text(route), /src="\/app\.js"/, route);
  });
});

test("config: the mail settings have safe defaults and the key is optional", () => {
  const plain = loadConfig({});
  assert.equal(plain.resendApiKey, null);
  assert.equal(plain.mailFrom, "Loan some <hello@loanso.me>");
  assert.equal(plain.appOrigin, "http://localhost:3000");
  assert.equal(loadConfig({ PORT: "4100" }).appOrigin, "http://localhost:4100");
  assert.equal(loadConfig({ NODE_ENV: "production" }).appOrigin, "https://www.loanso.me");
  assert.equal(loadConfig({ RAILWAY_ENVIRONMENT: "production" }).appOrigin, "https://www.loanso.me");
  assert.equal(loadConfig({ RESEND_API_KEY: "   " }).resendApiKey, null, "a blank key is no key");
  assert.equal(loadConfig({ RESEND_API_KEY: ` ${FAKE_KEY} ` }).resendApiKey, FAKE_KEY);
  assert.equal(loadConfig({ MAIL_FROM: " Hi <hi@example.com> " }).mailFrom, "Hi <hi@example.com>");
  assert.equal(loadConfig({ APP_ORIGIN: " https://example.com/// " }).appOrigin, "https://example.com");
  for (const bad of ["example.com", "ftp://example.com", "https://example.com/path", "javascript:alert(1)"]) {
    assert.throws(() => loadConfig({ APP_ORIGIN: bad }), /APP_ORIGIN/, bad);
  }
});

test("mail: no key means no mailer, and with a key it posts to Resend with the bearer key and fails without echoing it", async () => {
  assert.equal(createMailer(loadConfig({})), undefined);

  const calls: { url: string; init: RequestInit }[] = [];
  const fake = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  const mailer = createMailer(loadConfig({ RESEND_API_KEY: FAKE_KEY }), { fetch: fake });
  assert.ok(mailer);
  await mailer.send({ to: "a@example.com", subject: "s", text: "t", html: "<p>t</p>" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, `Bearer ${FAKE_KEY}`);
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.from, "Loan some <hello@loanso.me>");
  assert.equal(body.to, "a@example.com");

  const failing = createMailer(loadConfig({ RESEND_API_KEY: FAKE_KEY }), { fetch: (async () => new Response("bad key re_test_not_a_real_key", { status: 401 })) as unknown as typeof fetch });
  await assert.rejects(
    () => failing!.send({ to: "a@example.com", subject: "s", text: "t", html: "t" }),
    (error: unknown) => error instanceof MailerError && error.status === 401 && !error.message.includes(FAKE_KEY),
  );
});

test("db: an older database gains the email columns, keeps its users, and unverified duplicates are allowed but verified ones are not", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loaner-migrate-"));
  const file = path.join(dir, "old.db");
  try {
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, recovery_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
      INSERT INTO users VALUES ('u1', 'Old Olly', 'hash-1', 1);`);
    old.close();

    const db = openDb(file);
    const columns = (db.prepare("PRAGMA table_info(users)").all() as any[]).map((c) => c.name);
    assert.ok(columns.includes("email") && columns.includes("email_verified_at"));
    assert.deepEqual({ ...(db.prepare("SELECT id, name, email, email_verified_at FROM users").get() as object) }, { id: "u1", name: "Old Olly", email: null, email_verified_at: null });
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name = 'auth_links'").get(), "the links table exists");
    openDb(file).close();

    const insert = db.prepare("INSERT INTO users (id, name, recovery_hash, created_at, email, email_verified_at) VALUES (?, 'x', ?, 1, ?, ?)");
    insert.run("a", "ha", "same@example.com", null);
    insert.run("b", "hb", "same@example.com", null);
    insert.run("c", "hc", "same@example.com", 5);
    assert.throws(() => insert.run("d", "hd", "same@example.com", 6), /UNIQUE/);
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("static: index.html loads the donate script after the sheet script, and the CSP lets nothing reach PayPal", async () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const scripts = [...html.matchAll(/<script [^>]*src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(scripts.indexOf("/app-kit/ak-donate.js") > scripts.indexOf("/app-kit/ak-sheet.js"));
  assert.ok(scripts.indexOf("/app-kit/ak-donate.js") > scripts.indexOf("/app-kit/ak-dom.js"));
  await withApp(async (app) => {
    const res = await fetch(`http://127.0.0.1:${app.port}/app`);
    const csp = res.headers.get("content-security-policy") ?? "";
    assert.ok(csp.includes("connect-src"));
    assert.ok(!/paypal/i.test(csp), "the donate button only opens a link in a new tab, so no PayPal host is allowed");
  });
});
