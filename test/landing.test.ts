import assert from "node:assert/strict";
import test from "node:test";

type Decision = { view: "landing" } | { view: "app"; redirectTo: string | null };
type Landing = {
  APP_PATH: string;
  decideEntry: (input: { pathname?: string; hash?: string; signedIn?: boolean; standalone?: boolean }) => Decision;
  inviteCodeFrom: (text: unknown) => string | null;
};

// A classic script with no exports: importing it for its side effect puts the API on globalThis.
// It returns early when there is no document, so nothing touches the DOM here.
await import(new URL("../public/landing.js", import.meta.url).href);
const { decideEntry, inviteCodeFrom, APP_PATH } = (globalThis as unknown as { LoanerLanding: Landing }).LoanerLanding;

const LANDING: Decision = { view: "landing" };
const APP: Decision = { view: "app", redirectTo: null };

test("the app path is /app", () => {
  assert.equal(APP_PATH, "/app");
});

test("a signed-out visitor in a browser tab sees the landing at / and /landing.html", () => {
  assert.deepEqual(decideEntry({ pathname: "/", hash: "", signedIn: false, standalone: false }), LANDING);
  assert.deepEqual(decideEntry({ pathname: "/landing.html", hash: "", signedIn: false, standalone: false }), LANDING);
  assert.deepEqual(decideEntry({ pathname: "/", signedIn: false, standalone: false }), LANDING);
  assert.deepEqual(decideEntry({ pathname: "/" }), LANDING);
});

test("a signed-in visitor goes to /app, keeping the hash", () => {
  assert.deepEqual(decideEntry({ pathname: "/", hash: "", signedIn: true, standalone: false }), { view: "app", redirectTo: "/app" });
  assert.deepEqual(decideEntry({ pathname: "/", hash: "#/alerts", signedIn: true, standalone: false }), { view: "app", redirectTo: "/app#/alerts" });
  assert.deepEqual(decideEntry({ pathname: "/landing.html", hash: "#/you", signedIn: true, standalone: false }), { view: "app", redirectTo: "/app#/you" });
});

test("the installed app goes to /app even when signed out (standalone, fullscreen, iOS navigator.standalone)", () => {
  // isStandalone() folds all three signals into the one `standalone` flag, so each reaches decideEntry as true.
  assert.deepEqual(decideEntry({ pathname: "/", hash: "", signedIn: false, standalone: true }), { view: "app", redirectTo: "/app" });
  assert.deepEqual(decideEntry({ pathname: "/", hash: "#/recover", signedIn: false, standalone: true }), { view: "app", redirectTo: "/app#/recover" });
  assert.deepEqual(decideEntry({ pathname: "/", hash: "", signedIn: true, standalone: true }), { view: "app", redirectTo: "/app" });
});

test("/join/CODE is already the app shell: no landing, no redirect, good code or bad", () => {
  for (const pathname of ["/join/ABC123", "/join/ABC123/", "/join/NOPE", "/join/not-a-code!"]) {
    for (const signedIn of [false, true]) {
      for (const standalone of [false, true]) {
        assert.deepEqual(decideEntry({ pathname, hash: "", signedIn, standalone }), APP, `${pathname} signedIn=${signedIn} standalone=${standalone}`);
      }
    }
  }
});

test("/app and /app#/recover are the app: no landing, no redirect", () => {
  for (const hash of ["", "#/recover", "#/alerts"]) {
    for (const signedIn of [false, true]) {
      assert.deepEqual(decideEntry({ pathname: "/app", hash, signedIn, standalone: false }), APP, `${hash} signedIn=${signedIn}`);
    }
  }
  assert.deepEqual(decideEntry({ pathname: "/app", hash: "#/recover", signedIn: false, standalone: true }), APP);
});

test("inviteCodeFrom takes a bare code in any case, with stray spaces", () => {
  assert.equal(inviteCodeFrom("ABC123"), "ABC123");
  assert.equal(inviteCodeFrom("abc123"), "ABC123");
  assert.equal(inviteCodeFrom("  abc123  "), "ABC123");
  assert.equal(inviteCodeFrom("abc 123"), "ABC123");
});

test("inviteCodeFrom takes a pasted /join/CODE link", () => {
  assert.equal(inviteCodeFrom("https://www.loanso.me/join/ABC123"), "ABC123");
  assert.equal(inviteCodeFrom("https://www.loanso.me/join/abc123/"), "ABC123");
  assert.equal(inviteCodeFrom("http://127.0.0.1:3000/join/Zk9Q2?x=1"), "ZK9Q2");
  assert.equal(inviteCodeFrom("/join/ABC123"), "ABC123");
  assert.equal(inviteCodeFrom("https://www.loanso.me/join/ABC123#top"), "ABC123");
});

test("inviteCodeFrom rejects junk", () => {
  for (const junk of ["", "   ", "ab-c", "abc!", "<script>", "https://www.loanso.me/", "https://www.loanso.me/join/", "a/b", null, undefined]) {
    assert.equal(inviteCodeFrom(junk), null, String(junk));
  }
});
