// Writes the app icons to public/icons using only node built-ins. Run: npm run icons
// The white loop is read from public/icons/mark.svg (a stroked circle plus a stroked tail) and
// rasterised here, so no image dependency is needed.
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

/** Reads the loop geometry from mark.svg: viewBox size, stroke width, ring circle, and the tail as a polyline. */
function loadMark() {
  const svg = fs.readFileSync(path.join(OUT, "mark.svg"), "utf8");
  const num = (text) => text.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const box = num(/viewBox="([^"]+)"/.exec(svg)[1]);
  const width = Number(/stroke-width="([^"]+)"/.exec(svg)[1]);
  const [cx, cy, r] = ["cx", "cy", "r"].map((key) => Number(new RegExp(`<circle[^>]*\\b${key}="([^"]+)"`).exec(svg)[1]));
  const nums = num(/<path[^>]*\bd="([^"]+)"/.exec(svg)[1]);
  const points = [[nums[0], nums[1]]];
  for (let i = 2; i + 5 < nums.length; i += 6) {
    const [x0, y0] = points[points.length - 1];
    const [x1, y1, x2, y2, x3, y3] = nums.slice(i, i + 6);
    for (let step = 1; step <= 6; step += 1) {
      const t = step / 6;
      const m = 1 - t;
      points.push([
        m ** 3 * x0 + 3 * m * m * t * x1 + 3 * m * t * t * x2 + t ** 3 * x3,
        m ** 3 * y0 + 3 * m * m * t * y1 + 3 * m * t * t * y2 + t ** 3 * y3,
      ]);
    }
  }
  return { view: box[2], half: width / 2, cx, cy, r, points };
}

const mark = loadMark();
const tailBox = mark.points.reduce(
  (b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)],
  [Infinity, Infinity, -Infinity, -Infinity],
);

function segmentDistance(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** True when the point (in mark units) is inside the stroked ring or the stroked tail. */
function inLoop(px, py) {
  if (Math.abs(Math.hypot(px - mark.cx, py - mark.cy) - mark.r) <= mark.half) return true;
  const h = mark.half;
  if (px < tailBox[0] - h || px > tailBox[2] + h || py < tailBox[1] - h || py > tailBox[3] + h) return false;
  for (let i = 1; i < mark.points.length; i += 1) {
    if (segmentDistance(px, py, mark.points[i - 1], mark.points[i]) <= h) return true;
  }
  return false;
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
