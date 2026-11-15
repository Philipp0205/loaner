import assert from "node:assert/strict";
import test from "node:test";

type Helpers = {
  rgbToHex: (value: unknown) => string | null;
  pageBackground: (doc: FakeDoc, win: FakeWin) => string | null;
  applyThemeColor: (doc: FakeDoc, win: FakeWin) => string | null;
};
type FakeEl = { setAttribute: (name: string, value: string) => void; content?: string };
type FakeDoc = { documentElement: unknown; body: unknown; querySelector: (sel: string) => FakeEl | null };
type FakeWin = { getComputedStyle: (el: unknown) => { backgroundColor: string } };

const { rgbToHex, pageBackground, applyThemeColor } = (await import(
  new URL("../public/theme-color.js", import.meta.url).href
)) as Helpers;

test("rgbToHex turns computed rgb into #rrggbb", () => {
  assert.equal(rgbToHex("rgb(15, 28, 31)"), "#0f1c1f");
  assert.equal(rgbToHex("rgb(255, 255, 255)"), "#ffffff");
  assert.equal(rgbToHex("rgba(0, 0, 0, 1)"), "#000000");
  assert.equal(rgbToHex("rgba(34, 34, 34, 0.45)"), "#222222");
});

test("rgbToHex rejects transparent and unknown values", () => {
  assert.equal(rgbToHex("rgba(0, 0, 0, 0)"), null);
  assert.equal(rgbToHex("transparent"), null);
  assert.equal(rgbToHex("#0f1c1f"), null);
  assert.equal(rgbToHex(""), null);
  assert.equal(rgbToHex(undefined), null);
});

function fakeDocument(htmlColor: string, bodyColor: string) {
  const meta: FakeEl = { setAttribute(name, value) { if (name === "content") this.content = value; } };
  const html = { id: "html" };
  const body = { id: "body" };
  const colors = new Map<unknown, string>([[html, htmlColor], [body, bodyColor]]);
  const doc: FakeDoc = {
    documentElement: html,
    body,
    querySelector: (sel) => (sel === 'meta[name="theme-color"]' ? meta : null),
  };
  const win: FakeWin = { getComputedStyle: (el) => ({ backgroundColor: colors.get(el) ?? "" }) };
  return { doc, win, meta };
}

test("pageBackground reads html first, then body, and skips transparent html", () => {
  const painted = fakeDocument("rgb(15, 28, 31)", "rgb(255, 255, 255)");
  assert.equal(pageBackground(painted.doc, painted.win), "#0f1c1f");
  const bodyOnly = fakeDocument("rgba(0, 0, 0, 0)", "rgb(15, 28, 31)");
  assert.equal(pageBackground(bodyOnly.doc, bodyOnly.win), "#0f1c1f");
  const none = fakeDocument("rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)");
  assert.equal(pageBackground(none.doc, none.win), null);
});

test("applyThemeColor writes the painted background into the meta and keeps the old value when none is found", () => {
  const dark = fakeDocument("rgb(15, 28, 31)", "rgb(15, 28, 31)");
  assert.equal(applyThemeColor(dark.doc, dark.win), "#0f1c1f");
  assert.equal(dark.meta.content, "#0f1c1f");

  const none = fakeDocument("rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)");
  none.meta.content = "#ffffff";
  assert.equal(applyThemeColor(none.doc, none.win), null);
  assert.equal(none.meta.content, "#ffffff");
});
