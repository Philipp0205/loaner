import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

type Rect = { x: number; y: number; width: number; height: number };
const { containedRect, onPicture } = (await import(new URL("../public/photo-viewer.js", import.meta.url).href)) as {
  containedRect: (bw: number, bh: number, pw: number, ph: number) => Rect;
  onPicture: (point: { x: number; y: number }, bw: number, bh: number, pw: number, ph: number) => boolean;
};

test("containedRect fits a landscape photo inside a portrait phone, centred, aspect kept", () => {
  const r = containedRect(390, 844, 800, 600);
  assert.equal(r.width, 390);
  assert.ok(Math.abs(r.height - 292.5) < 0.001);
  assert.ok(Math.abs(r.width / r.height - 800 / 600) < 0.001);
  assert.equal(r.x, 0);
  assert.ok(Math.abs(r.y - (844 - r.height) / 2) < 0.001);
});

test("containedRect fits a tall photo by height", () => {
  const r = containedRect(390, 844, 600, 1600);
  assert.equal(r.height, 844);
  assert.ok(r.width < 390 && r.x > 0);
});

test("containedRect falls back to the whole box when the picture size is unknown", () => {
  assert.deepEqual(containedRect(390, 844, 0, 0), { x: 0, y: 0, width: 390, height: 844 });
});

test("onPicture: the letterbox bars count as backdrop, the photo does not", () => {
  // 800x600 in 390x844: the photo spans y 275 to 568.
  assert.equal(onPicture({ x: 195, y: 420 }, 390, 844, 800, 600), true);
  assert.equal(onPicture({ x: 195, y: 100 }, 390, 844, 800, 600), false);
  assert.equal(onPicture({ x: 195, y: 700 }, 390, 844, 800, 600), false);
});

/* showOverlay with a tiny DOM stub: it shares the sheet stack and the Back wiring. */

function setup() {
  const syncs: { depth: number; onPop: () => void }[] = [];
  const listeners = new Map<string, (e: any) => void>();
  const doc = {
    activeElement: null as any,
    body: { append: (n: any) => void (n.isConnected = true) },
    addEventListener: (t: string, fn: (e: any) => void) => void listeners.set(t, fn),
    removeEventListener: (t: string) => void listeners.delete(t),
  };
  (globalThis as any).document = doc;
  (globalThis as any).window = {
    AppKit: { nav: { syncOverlayHistory: (o: { depth: () => number; onPop: () => void }) => syncs.push({ depth: o.depth(), onPop: o.onPop }) } },
  };
  const node = { isConnected: false, remove() { this.isConnected = false; } };
  const focusable = () => ({ isConnected: true, focused: 0, focus() { this.focused += 1; } });
  return { syncs, listeners, doc, node, focusable };
}

test("showOverlay mounts, syncs history depth, and focuses the given element", async () => {
  const env = setup();
  const { showOverlay } = await import(new URL("../public/overlay.js", import.meta.url).href);
  const first = env.focusable();
  const back = env.focusable();
  const view = showOverlay(env.node, { focus: first, returnFocus: back });
  assert.equal(env.node.isConnected, true);
  assert.equal(first.focused, 1);
  assert.equal(env.syncs.at(-1)?.depth, 1);
  view.close();
  assert.equal(env.node.isConnected, false);
  assert.equal(env.syncs.at(-1)?.depth, 0);
  assert.equal(back.focused, 1, "focus goes back to the element that opened it");
  view.close();
  assert.equal(env.syncs.length, 2, "closing twice does nothing the second time");
});

test("showOverlay closes on Escape and on the Back handler, and calls onClose once", async () => {
  const env = setup();
  const { showOverlay } = await import(new URL("../public/overlay.js", import.meta.url).href);
  let closed = 0;
  showOverlay(env.node, { onClose: () => (closed += 1) });
  env.listeners.get("keydown")?.({ key: "a" });
  assert.equal(closed, 0, "other keys do nothing");
  env.listeners.get("keydown")?.({ key: "Escape" });
  assert.equal(closed, 1);
  assert.equal(env.listeners.has("keydown"), false, "the key listener is removed");

  const node2 = { isConnected: false, remove() { this.isConnected = false; } };
  showOverlay(node2, { onClose: () => (closed += 1) });
  env.syncs.at(-1)?.onPop();
  assert.equal(closed, 2, "Back closes the top layer");
  assert.equal(node2.isConnected, false);
});

test("the viewer is wired in: item detail only, own files cached, not an ak-sheet", () => {
  const read = (file: string) => fs.readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8");
  assert.match(read("browse.js"), /photoGallery\(item\)/);
  assert.match(read("photos/gallery.js"), /viewable\(photoEl\(item, "big"\), item\)/, "one photo keeps the single photo markup");
  assert.doesNotMatch(read("photo.js"), /viewable|openPhotoViewer/, "tiles and previews do not open the viewer");
  const viewer = read("photo-viewer.js");
  assert.match(viewer, /showOverlay/);
  assert.doesNotMatch(viewer, /ak-sheet|AppKit\.sheet/);
  assert.match(viewer, /role: "dialog"/);
  assert.match(viewer, /"aria-modal": "true"/);
  assert.match(read("index.html"), /href="\/css\/photo-viewer\.css"/);
  assert.doesNotMatch(read("photo-viewer.js") + read("css/photo-viewer.css"), /\u2014/);
});
