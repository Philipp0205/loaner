// Writes the app icons to public/icons using only node built-ins. Run: npm run icons
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
const BG = [196, 87, 45];
const FG = [255, 248, 240];

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

const inRect = (u, v, x0, y0, x1, y1) => u >= x0 && u <= x1 && v >= y0 && v <= y1;
const inCircle = (u, v, cx, cy, r) => (u - cx) ** 2 + (v - cy) ** 2 <= r * r;

/** A letter L with a small dot, the lent thing. u and v run 0 to 1. */
function glyph(u, v) {
  return inRect(u, v, 0.32, 0.22, 0.45, 0.76) || inRect(u, v, 0.32, 0.63, 0.7, 0.76) || inCircle(u, v, 0.62, 0.34, 0.075);
}

function roundedSquare(u, v, radius) {
  const dx = Math.max(radius - u, 0, u - (1 - radius));
  const dy = Math.max(radius - v, 0, v - (1 - radius));
  return dx * dx + dy * dy <= radius * radius;
}

function render(maskable) {
  return (x, y, size) => {
    const samples = 3;
    let cover = 0;
    let fg = 0;
    for (let sy = 0; sy < samples; sy += 1) {
      for (let sx = 0; sx < samples; sx += 1) {
        const u = (x + (sx + 0.5) / samples) / size;
        const v = (y + (sy + 0.5) / samples) / size;
        if (maskable || roundedSquare(u, v, 0.22)) {
          cover += 1;
          if (glyph(u, v)) fg += 1;
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
