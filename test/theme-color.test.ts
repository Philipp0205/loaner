import assert from "node:assert/strict";
import test from "node:test";
import { loadKit } from "./kit-harness.js";

const themeMetas = (head: { children: { tagName: string; getAttribute: (n: string) => string | null }[] }) =>
  head.children.filter((n) => n.tagName === "META" && n.getAttribute("name") === "theme-color");

test("toHex turns computed rgb into #rrggbb, comma or space separated", () => {
  const { toHex } = loadKit(["theme-color.js"]).window.AppKit.themeColor;
  assert.equal(toHex("rgb(15, 28, 31)"), "#0f1c1f");
  assert.equal(toHex("rgb(255, 255, 255)"), "#ffffff");
  assert.equal(toHex("rgba(0, 0, 0, 1)"), "#000000");
  assert.equal(toHex("rgb(15 28 31)"), "#0f1c1f");
  assert.equal(toHex("rgb(15 28 31 / 50%)"), "#0f1c1f");
  assert.equal(toHex("  rgb(0, 0, 0)  "), "#000000");
});

test("toHex rejects transparent and unknown values", () => {
  const { toHex } = loadKit(["theme-color.js"]).window.AppKit.themeColor;
  assert.equal(toHex("rgba(0, 0, 0, 0)"), null);
  assert.equal(toHex("rgb(0 0 0 / 0)"), null);
  assert.equal(toHex("transparent"), null);
  assert.equal(toHex("#0f1c1f"), null);
  assert.equal(toHex(""), null);
  assert.equal(toHex(undefined), null);
});

test("start() replaces the media-bound metas with one meta that holds the painted page colour", () => {
  const env = loadKit(["theme-color.js"], { htmlBackground: "rgb(0, 0, 0)", bodyBackground: "rgb(255, 255, 255)" });
  for (const [content, media] of [["#000000", "(prefers-color-scheme: dark) and (max-width: 719px)"], ["#ffffff", "(prefers-color-scheme: light) and (max-width: 719px)"]]) {
    const meta = env.document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    meta.setAttribute("content", content);
    meta.setAttribute("media", media);
    env.head.appendChild(meta);
  }
  env.window.AppKit.themeColor.start();
  const metas = themeMetas(env.head);
  assert.equal(metas.length, 1, "exactly one theme-color meta is left");
  assert.equal(metas[0].getAttribute("media"), null, "and it has no media attribute");
  assert.equal(metas[0].getAttribute("content"), "#000000", "html wins over body");
});

test("start() follows a scheme change, and falls back to body when html is transparent", () => {
  const env = loadKit(["theme-color.js"], { htmlBackground: "rgb(255, 255, 255)" });
  env.window.AppKit.themeColor.start();
  assert.equal(themeMetas(env.head)[0].getAttribute("content"), "#ffffff");
  env.style.html = "rgb(0, 0, 0)";
  env.setMedia(["(prefers-color-scheme: dark)"]);
  assert.equal(themeMetas(env.head).length, 1, "still one meta");
  assert.equal(themeMetas(env.head)[0].getAttribute("content"), "#000000");
  env.style.html = "rgba(0, 0, 0, 0)";
  env.style.body = "rgb(15, 28, 31)";
  env.setMedia([]);
  assert.equal(themeMetas(env.head)[0].getAttribute("content"), "#0f1c1f");
});

test("start() leaves the page alone when no solid colour is painted yet", () => {
  const env = loadKit(["theme-color.js"]);
  const meta = env.document.createElement("meta");
  meta.setAttribute("name", "theme-color");
  meta.setAttribute("content", "#ffffff");
  env.head.appendChild(meta);
  env.window.AppKit.themeColor.start();
  assert.equal(themeMetas(env.head).length, 1);
  assert.equal(themeMetas(env.head)[0].getAttribute("content"), "#ffffff");
});
