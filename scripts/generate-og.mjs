// Writes the social share image public/og.png (1200x630). Run: npm run og
// Draws the existing logo (mark + wordmark) and the Inter font with Chromium via playwright-core,
// already a devDependency. No extra dependencies.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "og.png");
const WIDTH = 1200;
const HEIGHT = 630;

const logo = fs.readFileSync(path.join(ROOT, "public", "logo.svg"), "utf8");
const font = fs.readFileSync(path.join(ROOT, "public", "fonts", "inter-latin-var.woff2")).toString("base64");

const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @font-face { font-family: "Inter"; font-weight: 100 900; src: url(data:font/woff2;base64,${font}) format("woff2"); }
    html, body { margin: 0; padding: 0; overflow: hidden; }
    body {
      width: ${WIDTH}px;
      height: ${HEIGHT}px;
      background: #ffffff;
      font-family: "Inter", sans-serif;
      position: relative;
    }
    .band { position: absolute; left: 0; right: 0; bottom: 0; height: 22px; background: linear-gradient(90deg, #2BB3A3, #00857A); }
    .glow { position: absolute; top: 0; right: 0; bottom: 22px; width: 380px; background: #E6F4F2; }
    .copy { position: absolute; left: 90px; top: 0; bottom: 22px; display: flex; flex-direction: column; justify-content: center; gap: 36px; }
    .logo { width: 640px; height: auto; display: block; }
    .logo svg { width: 100%; height: auto; display: block; }
    p { margin: 0; font-size: 46px; line-height: 1.2; font-weight: 600; letter-spacing: -0.02em; color: #1A2E33; max-width: 700px; }
    .sub { font-size: 30px; font-weight: 500; color: #4A5E63; letter-spacing: -0.01em; }
    .mark { position: absolute; right: 50px; top: 50%; margin-top: -150px; width: 280px; height: 280px; }
    .mark svg { width: 100%; height: 100%; display: block; }
  </style>
</head>
<body>
  <div class="glow"></div>
  <div class="copy">
    <div class="logo">${logo}</div>
    <div>
      <p>Lend things to your friends.</p>
      <p class="sub">Invite-only groups. No passwords. No payments.</p>
    </div>
  </div>
  <div class="mark">${markOnly()}</div>
  <div class="band"></div>
</body>
</html>`;

// The standalone mark. Its gradient id is renamed so it does not clash with the one inside logo.svg.
function markOnly() {
  const svg = fs.readFileSync(path.join(ROOT, "public", "icons", "mark.svg"), "utf8");
  return svg.replaceAll('id="teal"', 'id="teal-mark"').replaceAll("url(#teal)", "url(#teal-mark)");
}

async function launchBrowser() {
  const args = ["--hide-scrollbars"];
  try {
    return await chromium.launch({ channel: "chrome", headless: true, args });
  } catch {
    return await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true, args });
  }
}

const browser = await launchBrowser();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: WIDTH, height: HEIGHT } });
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  fs.writeFileSync(OUT, await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } }));
} finally {
  await browser.close();
}
console.log("wrote", OUT);
