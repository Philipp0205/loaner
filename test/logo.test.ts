import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { api, withApp } from "./http.js";

const read = (file: string) => fs.readFileSync(new URL(`../public/${file}`, import.meta.url));

test("logo.svg and mark.svg are served as SVG", async () => {
  await withApp(async (app) => {
    for (const file of ["/logo.svg", "/icons/mark.svg"]) {
      const res = await api(app, "GET", file);
      assert.equal(res.status, 200, file);
      assert.match(res.type, /^image\/svg\+xml/, file);
      assert.match(res.bytes.toString("utf8"), /<svg[\s>]/, file);
    }
  });
});

test("the four app icons are PNGs at the sizes the manifest lists", () => {
  const manifest = JSON.parse(read("manifest.webmanifest").toString("utf8")) as { icons: { src: string; sizes: string }[] };
  for (const name of ["icon-192", "icon-512", "icon-maskable-192", "icon-maskable-512"]) {
    const bytes = read(`icons/${name}.png`);
    assert.deepEqual([...bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], name);
    const size = Number(name.split("-").pop());
    assert.equal(bytes.readUInt32BE(16), size, `${name} width`);
    assert.equal(bytes.readUInt32BE(20), size, `${name} height`);
    const entry = manifest.icons.find((icon) => icon.src === `/icons/${name}.png`);
    assert.equal(entry?.sizes, `${size}x${size}`, `${name} in manifest`);
  }
});

test("the wordmark heading keeps the name Loan some and hides the image from screen readers", () => {
  const util = read("util.js").toString("utf8");
  assert.match(util, /"aria-label": "Loan some"/);
  assert.match(util, /alt: ""/);
  for (const file of ["gate.js", "browse.js"]) assert.match(read(file).toString("utf8"), /wordmarkHeading\(\)/, file);
});
