// Writes the app icons to public/icons. Run: npm run icons
// Rasterises mark.svg with Chromium (via playwright-core, already a devDependency)
// so the PNGs match the SVG exactly. No extra runtime or dev dependencies.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "icons");
const TEAL = "#00857A";
const SIZES = [192, 512];
const SCALE = 3; // supersample, then downscale in the browser for smooth edges
const CORNER = 0.22; // rounded-square radius for "any" icons, as a fraction of size

function markParts(svg) {
  const viewBox = /viewBox="([^"]+)"/.exec(svg)[1];
  const width = /stroke-width="([^"]+)"/.exec(svg)[1];
  const d = /<path[^>]*\bd="([^"]+)"/.exec(svg)[1];
  const points = /<polygon[^>]*\bpoints="([^"]+)"/.exec(svg)[1];
  if (!viewBox || !width || !d || !points) throw new Error("mark.svg is missing viewBox, arc path, stroke-width, or polygon");
  return { viewBox, width, d, points };
}

function iconSvg(size, maskable, parts) {
  const corner = maskable ? "" : ` rx="${size * CORNER}" ry="${size * CORNER}"`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}"${corner} fill="${TEAL}"/>
  <svg x="0" y="0" width="${size}" height="${size}" viewBox="${parts.viewBox}">
    <path d="${parts.d}" fill="none" stroke="#FFFFFF" stroke-width="${parts.width}" stroke-linecap="round"/>
    <polygon points="${parts.points}" fill="#FFFFFF"/>
  </svg>
</svg>`;
}

function pageHtml(size, svg) {
  const big = size * SCALE;
  const data = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
    canvas { display: block; }
  </style>
</head>
<body>
  <canvas id="out" width="${size}" height="${size}"></canvas>
  <script>
    const done = (ok, err) => { window.__icon = ok ? "ok" : String(err || "fail"); };
    const img = new Image();
    img.onload = () => {
      try {
        const big = document.createElement("canvas");
        big.width = ${big};
        big.height = ${big};
        const bctx = big.getContext("2d");
        bctx.drawImage(img, 0, 0, ${big}, ${big});
        const out = document.getElementById("out");
        const ctx = out.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(big, 0, 0, ${size}, ${size});
        done(true);
      } catch (error) {
        done(false, error);
      }
    };
    img.onerror = () => done(false, "image error");
    img.src = ${JSON.stringify(data)};
  </script>
</body>
</html>`;
}

async function launchBrowser() {
  const args = ["--hide-scrollbars"];
  try {
    return await chromium.launch({ channel: "chrome", headless: true, args });
  } catch {
    return await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true, args });
  }
}

const parts = markParts(fs.readFileSync(path.join(OUT, "mark.svg"), "utf8"));
const browser = await launchBrowser();
try {
  fs.mkdirSync(OUT, { recursive: true });
  for (const size of SIZES) {
    for (const maskable of [false, true]) {
      const name = maskable ? `icon-maskable-${size}.png` : `icon-${size}.png`;
      const page = await browser.newPage({
        deviceScaleFactor: 1,
        viewport: { width: size, height: size },
      });
      await page.setContent(pageHtml(size, iconSvg(size, maskable, parts)), { waitUntil: "load" });
      await page.waitForFunction(() => window.__icon === "ok");
      const filled = await page.evaluate(() => {
        const c = document.getElementById("out");
        const { data } = c.getContext("2d").getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1);
        return data[3] > 0;
      });
      if (!filled) throw new Error(`${name}: canvas center is transparent after draw`);
      const buf = await page.locator("#out").screenshot({ type: "png", omitBackground: true });
      fs.writeFileSync(path.join(OUT, name), buf);
      await page.close();
    }
  }
} finally {
  await browser.close();
}
console.log("wrote icons to", OUT);
