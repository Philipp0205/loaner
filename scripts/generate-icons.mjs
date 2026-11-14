// Writes the app icons to public/icons using only node built-ins. Run: npm run icons
// The white circular arrow is read from public/icons/mark.svg (a stroked arc plus a triangular
// arrowhead) and rasterised here, so no image dependency is needed.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "icons");
const BG = [0, 133, 122];
const FG = [255, 255, 255];

function crc32(buf) {
  let c;
  let crc = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = pixel(x, y, size);
      raw.set([r, g, b, a], row + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Reads the circular-arrow geometry from mark.svg: viewBox, stroked arc, and triangular head. */
function loadMark() {
  const svg = fs.readFileSync(path.join(OUT, "mark.svg"), "utf8");
  const num = (text) => text.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const box = num(/viewBox="([^"]+)"/.exec(svg)[1]);
  const width = Number(/stroke-width="([^"]+)"/.exec(svg)[1]);
  const d = /<path[^>]*\bd="([^"]+)"/.exec(svg)[1];
  const [sx, sy, r, , , , , ex, ey] = num(d);
  const pts = num(/<polygon[^>]*\bpoints="([^"]+)"/.exec(svg)[1]);
  const cx = box[2] / 2;
  const cy = box[3] / 2;
  const angle = (x, y) => {
    const a = Math.atan2(y - cy, x - cx);
    return a < 0 ? a + Math.PI * 2 : a;
  };
  return {
    view: box[2],
    half: width / 2,
    cx,
    cy,
    r,
    start: [sx, sy],
    end: [ex, ey],
    startAng: angle(sx, sy),
    endAng: angle(ex, ey),
    triangle: [
      [pts[0], pts[1]],
      [pts[2], pts[3]],
      [pts[4], pts[5]],
    ],
  };
}

const mark = loadMark();

function inTriangle(px, py, [[ax, ay], [bx, by], [cx, cy]]) {
  const d = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const s = ((px - ax) * (cy - ay) - (py - ay) * (cx - ax)) / d;
  const t = ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) / d;
  return s >= 0 && t >= 0 && s + t <= 1;
}

/** True when the point (in mark units) is inside the stroked arc (with round caps) or the arrowhead. */
function inLoop(px, py) {
  if (inTriangle(px, py, mark.triangle)) return true;
  if (Math.hypot(px - mark.start[0], py - mark.start[1]) <= mark.half) return true;
  if (Math.hypot(px - mark.end[0], py - mark.end[1]) <= mark.half) return true;
  if (Math.abs(Math.hypot(px - mark.cx, py - mark.cy) - mark.r) > mark.half) return false;
  const a = Math.atan2(py - mark.cy, px - mark.cx);
  const ang = a < 0 ? a + Math.PI * 2 : a;
  // Arc runs the long way from startAng (~317°) down to endAng (~22°), i.e. endAng <= ang <= startAng.
  return ang >= mark.endAng && ang <= mark.startAng;
}

function roundedSquare(u, v, radius) {
  const dx = Math.max(radius - u, 0, u - (1 - radius));
  const dy = Math.max(radius - v, 0, v - (1 - radius));
  return dx * dx + dy * dy <= radius * radius;
}

function render(maskable) {
  return (x, y, size) => {
    const samples = 4;
    let cover = 0;
    let fg = 0;
    for (let sy = 0; sy < samples; sy += 1) {
      for (let sx = 0; sx < samples; sx += 1) {
        const u = (x + (sx + 0.5) / samples) / size;
        const v = (y + (sy + 0.5) / samples) / size;
        if (maskable || roundedSquare(u, v, 0.22)) {
          cover += 1;
          if (inLoop(u * mark.view, v * mark.view)) fg += 1;
        }
      }
    }
    if (cover === 0) return [0, 0, 0, 0];
    const mix = fg / cover;
    const channel = (i) => Math.round(BG[i] * (1 - mix) + FG[i] * mix);
    return [channel(0), channel(1), channel(2), Math.round((255 * cover) / (samples * samples))];
  };
}

fs.mkdirSync(OUT, { recursive: true });
for (const size of [192, 512]) {
  fs.writeFileSync(path.join(OUT, `icon-${size}.png`), png(size, render(false)));
  fs.writeFileSync(path.join(OUT, `icon-maskable-${size}.png`), png(size, render(true)));
}
console.log("wrote icons to", OUT);
