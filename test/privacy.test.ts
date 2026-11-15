import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { withApp } from "./http.js";

// Philipp replaces this with a real name and email. While it is still on the page this test passes,
// and once it is removed the test fails, so the placeholder cannot be forgotten. Update both together.
const PLACEHOLDER = "[CONTACT NAME AND EMAIL \u2014 Philipp to fill in]";

const read = (file: string) => fs.readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8");

async function get(port: number, method: string, pathname: string) {
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`, { method });
  return { status: res.status, type: res.headers.get("content-type") ?? "", text: await res.text() };
}

test("GET /privacy serves the privacy page, not the app shell", async () => {
  const page = read("privacy.html");
  const shell = read("index.html");
  await withApp(async (app) => {
    for (const pathname of ["/privacy", "/privacy/", "/privacy.html"]) {
      const res = await get(app.port, "GET", pathname);
      assert.equal(res.status, 200, pathname);
      assert.match(res.type, /^text\/html/, pathname);
      assert.equal(res.text, page, pathname);
      assert.notEqual(res.text, shell, pathname);
      assert.ok(res.text.includes(PLACEHOLDER), pathname);
    }
    const head = await get(app.port, "HEAD", "/privacy");
    assert.equal(head.status, 200);
    assert.match(head.type, /^text\/html/);
    assert.equal(head.text, "");
  });
});

test("other extensionless paths still get the app shell", async () => {
  const shell = read("index.html");
  await withApp(async (app) => {
    for (const pathname of ["/", "/join/ABC123", "/privacy-policy", "/privacy/extra", "/x/privacy"]) {
      const res = await get(app.port, "GET", pathname);
      assert.equal(res.status, 200, pathname);
      assert.equal(res.text, shell, pathname);
    }
  });
});

test("the contact placeholder is visible on the page and next to an HTML comment", () => {
  const html = read("privacy.html");
  assert.ok(html.includes(PLACEHOLDER), "the exact contact placeholder is missing");
  const visible = html.replace(/<!--[\s\S]*?-->/g, "");
  assert.ok(visible.includes(PLACEHOLDER), "the placeholder must be visible, not only in a comment");
  assert.match(html, /<!--[^>]*Philipp[^>]*-->\s*<p class="contact">/);
});

test("the privacy page has its sections in order, styles from the app, and no script", () => {
  const html = read("privacy.html");
  const headings = [...html.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1]);
  assert.deepEqual(headings, [
    "1. Who runs it",
    "2. What we store and why",
    "3. What we don't do",
    "4. Where it's stored",
    "5. Who else sees data",
    "6. How long we keep it",
    "7. Your rights and getting your data deleted",
    "8. Contact",
  ]);
  assert.match(html, /href="\/css\/tokens\.css"/);
  assert.match(html, /href="\/css\/base\.css"/);
  assert.match(html, /name="viewport"/);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html.replace(PLACEHOLDER, ""), /\u2014/);
  assert.match(read("css/privacy.css"), /\.page\.article/);
});

test("the privacy page does not claim things that are not true", () => {
  const text = read("privacy.html").replace(/<[^>]+>/g, " ");
  assert.doesNotMatch(text, /EU (company|provider)/i);
  assert.match(text, /no way to delete your whole account/);
  assert.match(text, /Railway itself is a US company/);
});

test("the sign-in, recovery and join screens and the You tab link to /privacy", () => {
  const gate = read("gate.js");
  assert.match(gate, /href: "\/privacy"/);
  // welcome, recovery, join and the bad invite screen all end with the link
  assert.equal(gate.match(/privacyLink\(\)/g)?.length, 5, "one definition and four screens");
  const you = read("you.js");
  assert.match(you, /id: "open-privacy", href: "\/privacy"/);
});
