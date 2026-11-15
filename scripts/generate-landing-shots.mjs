// Writes the home page phone screenshots (public/landing/phone-*.png and shelf-*.png) from seeded demo data.
// Run: npm run landing-shots
//
// The item photos (a cordless drill, a tent, a ladder, a Dutch oven) were drawn locally with a canvas in
// headless Chromium by this script. They are original artwork, so they are license-free. The generated
// JPEGs are committed in scripts/landing-demo/ so the source of the screenshots is reviewable.
// All people are made up (Tess, Bo, Ines) and the database is in memory. Nothing real is read or written.
//
// It starts the app the same way the UI tests do (random port, in-memory db), uploads the photos through the
// API, then screenshots the item detail and the shelf in light and dark at 390x844, scale 2 (780x1688).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHANGELOG } from "../public/changelog.js";
import { PHONE, UA, launchChrome, startServer } from "../test/ui/harness.ts";
import { makeGroup, joinWith, makeItem, ok, signUp } from "../test/http.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEMO = path.join(ROOT, "scripts", "landing-demo");
const OUT = path.join(ROOT, "public", "landing");

/** Draws one still-life on a 1200x1000 canvas. Runs in the browser, so it must not use anything outside itself. */
function drawScene(kind) {
  const W = 1200;
  const H = 1000;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d");

  let seed = 7 + kind.length * 101;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const lin = (x0, y0, x1, y1, stops) => {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    for (const [o, c] of stops) gr.addColorStop(o, c);
    return gr;
  };
  const fill = (style, build) => {
    g.beginPath();
    build();
    g.fillStyle = style;
    g.fill();
  };
  const rrect = (x, y, w, h, r) => g.roundRect(x, y, w, h, r);
  const shadow = (cx, cy, rx, ry, a) => {
    g.save();
    g.filter = "blur(16px)";
    g.fillStyle = `rgba(0,0,0,${a})`;
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  };
  const finish = () => {
    const v = g.createRadialGradient(W / 2, H / 2, 330, W / 2, H / 2, 800);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,0.3)");
    g.fillStyle = v;
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 26000; i++) {
      g.fillStyle = rand() < 0.5 ? "rgba(0,0,0,0.035)" : "rgba(255,255,255,0.035)";
      g.fillRect(rand() * W, rand() * H, 2, 2);
    }
  };
  const planks = (top, base, edge) => {
    g.fillStyle = lin(0, top, 0, H, [[0, base[0]], [1, base[1]]]);
    g.fillRect(0, top, W, H - top);
    for (let y = top + 70, row = 0; y < H + 60; y += 90 + row * 22, row++) {
      g.fillStyle = edge;
      g.fillRect(0, y, W, 4);
    }
    for (let i = 0; i < 260; i++) {
      const y = top + rand() * (H - top);
      const x = rand() * W;
      g.strokeStyle = `rgba(60,35,15,${0.05 + rand() * 0.07})`;
      g.lineWidth = 1 + rand() * 2;
      g.beginPath();
      g.moveTo(x, y);
      g.bezierCurveTo(x + 60, y - 4, x + 120, y + 5, x + 200 + rand() * 200, y);
      g.stroke();
    }
  };

  if (kind === "drill") {
    // Wall and a workbench.
    g.fillStyle = lin(0, 0, 0, 640, [[0, "#cfd3d4"], [1, "#b7bcbd"]]);
    g.fillRect(0, 0, W, 640);
    planks(620, ["#b98b58", "#8a5f35"], "rgba(50,28,10,0.45)");
    g.fillStyle = "rgba(0,0,0,0.25)";
    g.fillRect(0, 612, W, 12);
    shadow(600, 818, 330, 34, 0.5);
    // A pencil and a few screws.
    g.save();
    g.translate(840, 880);
    g.rotate(-0.12);
    fill(lin(0, -9, 0, 9, [[0, "#f3c33b"], [1, "#c8921a"]]), () => rrect(0, -9, 230, 18, 3));
    fill("#e8c9a0", () => { g.moveTo(0, -9); g.lineTo(-34, 0); g.lineTo(0, 9); g.closePath(); });
    fill("#2b2b2b", () => { g.moveTo(-34, 0); g.lineTo(-48, 0); g.lineTo(-34, -3); g.closePath(); });
    fill("#d04b4b", () => rrect(222, -9, 26, 18, 4));
    g.restore();
    for (const [x, y, a] of [[300, 880, 0.4], [350, 905, -0.3], [330, 850, 1.2]]) {
      g.save();
      g.translate(x, y);
      g.rotate(a);
      fill(lin(0, -8, 0, 8, [[0, "#e9eaeb"], [1, "#8d9193"]]), () => rrect(0, -4, 64, 8, 3));
      fill("#b9bcbe", () => rrect(-8, -9, 14, 18, 4));
      g.restore();
    }
    // The drill, pointing left. Bit, chuck, collar.
    fill(lin(0, 448, 0, 470, [[0, "#f1f2f3"], [1, "#7c8184"]]), () => rrect(290, 452, 110, 12, 5));
    g.strokeStyle = "rgba(60,60,60,0.55)";
    g.lineWidth = 2;
    for (let x = 300; x < 400; x += 12) {
      g.beginPath();
      g.moveTo(x, 455);
      g.lineTo(x + 8, 462);
      g.stroke();
    }
    fill(lin(0, 420, 0, 505, [[0, "#f4f5f5"], [0.35, "#b4b8ba"], [0.7, "#7c8184"], [1, "#4b4f51"]]), () => rrect(385, 420, 95, 85, 10));
    g.strokeStyle = "rgba(40,40,40,0.45)";
    g.lineWidth = 2;
    for (let x = 400; x < 475; x += 10) {
      g.beginPath();
      g.moveTo(x, 424);
      g.lineTo(x, 500);
      g.stroke();
    }
    fill(lin(0, 410, 0, 515, [[0, "#4a4f52"], [1, "#1f2224"]]), () => rrect(478, 408, 34, 108, 8));
    // Motor housing.
    fill(lin(0, 395, 0, 530, [[0, "#ffd84a"], [0.45, "#f2b705"], [1, "#b98000"]]), () => rrect(508, 396, 300, 132, [30, 56, 56, 30]));
    fill(lin(0, 395, 0, 530, [[0, "#3b4044"], [1, "#16191b"]]), () => rrect(770, 400, 112, 124, [10, 56, 56, 10]));
    g.fillStyle = "rgba(255,255,255,0.45)";
    g.beginPath();
    g.roundRect(540, 408, 230, 14, 7);
    g.fill();
    g.fillStyle = "rgba(0,0,0,0.35)";
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      g.roundRect(800 + i * 12, 430, 6, 70, 3);
      g.fill();
    }
    // Clutch ring and a gear switch on top.
    fill(lin(0, 0, 0, 1, [[0, "#2a2e31"], [1, "#2a2e31"]]), () => rrect(512, 470, 36, 46, 4));
    fill(lin(0, 380, 0, 400, [[0, "#454a4e"], [1, "#1c1f21"]]), () => rrect(610, 380, 90, 24, 6));
    g.fillStyle = "#e6e8e9";
    g.font = "600 15px Inter, Arial, sans-serif";
    g.fillText("1   2", 633, 397);
    // Pistol grip, trigger and battery.
    fill(lin(640, 0, 800, 0, [[0, "#3a3f43"], [0.5, "#2a2e31"], [1, "#16191b"]]), () => {
      g.moveTo(650, 515);
      g.lineTo(790, 515);
      g.lineTo(826, 748);
      g.lineTo(704, 752);
      g.closePath();
    });
    g.strokeStyle = "rgba(255,255,255,0.12)";
    g.lineWidth = 3;
    for (let y = 560; y < 720; y += 22) {
      g.beginPath();
      g.moveTo(668 + (y - 515) * 0.1, y);
      g.lineTo(790 + (y - 515) * 0.16, y);
      g.stroke();
    }
    fill(lin(0, 0, 40, 0, [[0, "#f2b705"], [1, "#b98000"]]), () => rrect(618, 520, 44, 62, [8, 8, 16, 16]));
    fill(lin(0, 740, 0, 815, [[0, "#44494d"], [1, "#16191b"]]), () => rrect(664, 744, 224, 74, [8, 8, 14, 14]));
    fill(lin(0, 0, 0, 1, [[0, "#f2b705"], [1, "#f2b705"]]), () => rrect(664, 744, 224, 14, 6));
    g.fillStyle = "#d8dadb";
    g.font = "700 20px Inter, Arial, sans-serif";
    g.fillText("18V", 690, 795);
    for (let i = 0; i < 4; i++) {
      fill(i < 3 ? "#5fd16f" : "#2f3a31", () => rrect(790 + i * 22, 773, 14, 26, 3));
    }
  }

  if (kind === "tent") {
    g.fillStyle = lin(0, 0, 0, 600, [[0, "#7fc0ea"], [1, "#e9f5fb"]]);
    g.fillRect(0, 0, W, 600);
    g.save();
    g.filter = "blur(10px)";
    fill("#6f9a72", () => { g.moveTo(-50, 560); g.bezierCurveTo(150, 380, 380, 380, 560, 560); g.closePath(); });
    fill("#557f5c", () => { g.moveTo(420, 560); g.bezierCurveTo(700, 330, 1000, 360, 1300, 560); g.closePath(); });
    g.restore();
    fill("#fff", () => { g.ellipse(210, 150, 90, 28, 0, 0, Math.PI * 2); g.ellipse(270, 135, 70, 30, 0, 0, Math.PI * 2); });
    g.fillStyle = "rgba(255,255,255,0.8)";
    g.beginPath();
    g.ellipse(930, 210, 110, 30, 0, 0, Math.PI * 2);
    g.ellipse(860, 195, 70, 28, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = lin(0, 540, 0, H, [[0, "#6aa84f"], [1, "#2f6a2b"]]);
    g.fillRect(0, 540, W, H - 540);
    g.strokeStyle = "rgba(20,70,20,0.35)";
    g.lineWidth = 3;
    for (let i = 0; i < 700; i++) {
      const x = rand() * W;
      const y = 560 + rand() * 440;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (rand() - 0.5) * 10, y - 8 - rand() * 14);
      g.stroke();
    }
    shadow(610, 805, 380, 40, 0.5);
    // Guy lines and pegs.
    g.strokeStyle = "#f4e9d3";
    g.lineWidth = 3;
    for (const [x0, y0, x1, y1] of [[360, 560, 215, 790], [850, 560, 1000, 790]]) {
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
      fill("#d9d9d9", () => rrect(x1 - 4, y1 - 4, 8, 22, 3));
    }
    // Dome with a lighter top and a darker skirt.
    const dome = () => {
      g.moveTo(290, 800);
      g.bezierCurveTo(290, 330, 910, 330, 910, 800);
      g.closePath();
    };
    fill(lin(290, 0, 910, 0, [[0, "#f07a22"], [0.5, "#ff9a3d"], [1, "#c9540f"]]), dome);
    g.save();
    g.beginPath();
    dome();
    g.clip();
    fill(lin(0, 330, 0, 800, [[0, "rgba(255,255,255,0.28)"], [0.5, "rgba(255,255,255,0)"], [1, "rgba(0,0,0,0.22)"]]), () => g.rect(280, 320, 640, 490));
    fill("#2f4a63", () => g.rect(280, 735, 640, 80));
    g.restore();
    // Poles.
    g.strokeStyle = "#2b3239";
    g.lineWidth = 9;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(290, 740);
    g.bezierCurveTo(300, 360, 900, 360, 910, 740);
    g.stroke();
    g.beginPath();
    g.moveTo(420, 780);
    g.bezierCurveTo(470, 380, 730, 380, 780, 780);
    g.stroke();
    // Door.
    fill("#1d2724", () => {
      g.moveTo(490, 800);
      g.bezierCurveTo(490, 620, 540, 510, 600, 510);
      g.bezierCurveTo(660, 510, 710, 620, 710, 800);
      g.closePath();
    });
    fill(lin(490, 0, 640, 0, [[0, "#ffae5c"], [1, "#e0661a"]]), () => {
      g.moveTo(490, 800);
      g.bezierCurveTo(490, 620, 540, 510, 600, 510);
      g.bezierCurveTo(580, 600, 585, 700, 610, 800);
      g.closePath();
    });
    g.strokeStyle = "#e8e2d4";
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(600, 510);
    g.bezierCurveTo(580, 600, 585, 700, 610, 800);
    g.stroke();
    fill("#e8e2d4", () => rrect(596, 640, 12, 30, 5));
  }

  if (kind === "ladder") {
    g.fillStyle = lin(0, 0, 0, 760, [[0, "#d9dfe3"], [1, "#b9c2c8"]]);
    g.fillRect(0, 0, W, 760);
    g.strokeStyle = "rgba(0,0,0,0.07)";
    g.lineWidth = 3;
    for (let y = 40; y < 760; y += 74) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y);
      g.stroke();
    }
    g.fillStyle = lin(0, 740, 0, H, [[0, "#9c9fa1"], [1, "#6d7072"]]);
    g.fillRect(0, 740, W, H - 740);
    g.fillStyle = "rgba(0,0,0,0.22)";
    g.fillRect(0, 734, W, 10);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = rand() < 0.5 ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.06)";
      g.fillRect(rand() * W, 745 + rand() * 255, 3, 3);
    }
    const railAt = (y, side) => {
      const t = (y - 110) / 770;
      const cx = 600 + 8 * t;
      const half = 130 + 100 * t;
      return side === "l" ? cx - half : cx + half;
    };
    // Cast shadow on the wall.
    g.save();
    g.filter = "blur(10px)";
    g.fillStyle = "rgba(0,0,0,0.2)";
    g.beginPath();
    g.moveTo(railAt(110, "l") + 80, 120);
    g.lineTo(railAt(110, "r") + 90, 120);
    g.lineTo(railAt(880, "r") + 60, 880);
    g.lineTo(railAt(880, "l") + 50, 880);
    g.closePath();
    g.fill();
    g.restore();
    shadow(600, 892, 270, 20, 0.45);
    // Rungs first, then rails on top.
    for (let i = 0; i < 9; i++) {
      const y = 170 + i * 85;
      const l = railAt(y, "l");
      const r = railAt(y, "r");
      fill("rgba(0,0,0,0.25)", () => rrect(l + 8, y + 22, r - l - 10, 12, 6));
      fill(lin(0, y - 14, 0, y + 16, [[0, "#f4f6f7"], [0.5, "#aeb4b8"], [1, "#6c7276"]]), () => rrect(l, y - 14, r - l, 30, 6));
    }
    for (const side of ["l", "r"]) {
      const x0 = railAt(110, side);
      const x1 = railAt(880, side);
      const w0 = 22;
      const w1 = 34;
      fill(lin(Math.min(x0, x1) - 20, 0, Math.max(x0, x1) + 40, 0, [[0, "#ffd45c"], [0.4, "#f2a900"], [1, "#a86e00"]]), () => {
        g.moveTo(x0 - w0 / 2, 110);
        g.lineTo(x0 + w0 / 2, 110);
        g.lineTo(x1 + w1 / 2, 880);
        g.lineTo(x1 - w1 / 2, 880);
        g.closePath();
      });
      g.strokeStyle = "rgba(255,255,255,0.45)";
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(x0 - w0 / 4, 112);
      g.lineTo(x1 - w1 / 4, 878);
      g.stroke();
      fill("#202325", () => rrect(x1 - w1 / 2 - 6, 872, w1 + 12, 26, 6));
      fill("#202325", () => rrect(x0 - w0 / 2 - 2, 100, w0 + 4, 16, 5));
    }
    // Rung rivets.
    g.fillStyle = "#6e7479";
    for (let i = 0; i < 9; i++) {
      const y = 170 + i * 85;
      for (const side of ["l", "r"]) {
        g.beginPath();
        g.arc(railAt(y, side), y, 4, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  if (kind === "pot") {
    g.fillStyle = "#eef0ee";
    g.fillRect(0, 0, W, 600);
    g.save();
    g.filter = "blur(3px)";
    g.strokeStyle = "rgba(90,100,95,0.3)";
    g.lineWidth = 4;
    for (let y = 0, row = 0; y < 600; y += 70, row++) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y);
      g.stroke();
      for (let x = (row % 2) * 80; x < W; x += 160) {
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x, y + 70);
        g.stroke();
      }
    }
    g.restore();
    planks(590, ["#c99a67", "#9a6c3f"], "rgba(60,32,12,0.4)");
    g.fillStyle = "rgba(0,0,0,0.22)";
    g.fillRect(0, 582, W, 12);
    shadow(600, 800, 330, 38, 0.5);
    // Body.
    const body = lin(330, 0, 870, 0, [[0, "#9e2a10"], [0.22, "#e2491c"], [0.55, "#c63a14"], [1, "#7e1f0a"]]);
    fill(body, () => {
      g.moveTo(330, 520);
      g.bezierCurveTo(330, 730, 430, 808, 600, 808);
      g.bezierCurveTo(770, 808, 870, 730, 870, 520);
      g.closePath();
    });
    // Side handles.
    g.strokeStyle = "#8b2410";
    g.lineWidth = 22;
    g.lineCap = "round";
    for (const dir of [-1, 1]) {
      g.beginPath();
      g.moveTo(600 + dir * 268, 560);
      g.bezierCurveTo(600 + dir * 345, 548, 600 + dir * 345, 628, 600 + dir * 282, 628);
      g.stroke();
    }
    // Lid.
    fill(lin(320, 0, 880, 0, [[0, "#a22c11"], [0.25, "#ea5222"], [0.6, "#c93b14"], [1, "#80200b"]]), () => {
      g.moveTo(318, 520);
      g.bezierCurveTo(330, 410, 470, 350, 600, 350);
      g.bezierCurveTo(730, 350, 870, 410, 882, 520);
      g.bezierCurveTo(800, 548, 400, 548, 318, 520);
      g.closePath();
    });
    fill("#1e1e1e", () => { g.ellipse(600, 528, 282, 26, 0, 0, Math.PI); });
    fill(lin(0, 520, 0, 556, [[0, "#f3604a"], [1, "#9a2a10"]]), () => { g.ellipse(600, 524, 284, 24, 0, 0, Math.PI); });
    fill("#2a2a2a", () => rrect(570, 322, 60, 42, 14));
    fill(lin(0, 318, 0, 340, [[0, "#6a6a6a"], [1, "#222"]]), () => { g.ellipse(600, 326, 36, 14, 0, 0, Math.PI * 2); });
    // Shine.
    g.fillStyle = "rgba(255,255,255,0.4)";
    g.beginPath();
    g.ellipse(430, 650, 26, 100, 0.35, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(455, 440, 22, 60, 0.9, 0, Math.PI * 2);
    g.fill();
    // Maker plate.
    g.fillStyle = "rgba(255,255,255,0.8)";
    g.font = "700 30px Georgia, serif";
    g.textAlign = "center";
    g.fillText("No. 26", 600, 720);
    // A wooden spoon on the counter.
    g.save();
    g.translate(900, 905);
    g.rotate(-0.22);
    fill(lin(0, -10, 0, 10, [[0, "#d6a56a"], [1, "#a8743a"]]), () => rrect(-190, -9, 250, 18, 9));
    fill(lin(0, -34, 0, 34, [[0, "#dcae74"], [1, "#a8743a"]]), () => { g.ellipse(88, 0, 52, 34, 0, 0, Math.PI * 2); });
    g.restore();
  }

  finish();
  return canvas.toDataURL("image/jpeg", 0.86);
}

const PHOTOS = [
  { key: "drill", name: "Cordless drill", note: "Battery lasts about 30 min", category: "Tools", owner: "Tess" },
  { key: "tent", name: "Tent for three", note: "Pegs and a footprint included", category: "Camping", owner: "Bo" },
  { key: "ladder", name: "Ladder", note: "Reaches 3 m", category: "Tools", owner: "Tess" },
  { key: "pot", name: "Dutch oven", note: "Big enough for a whole chicken", category: "Kitchen", owner: "Ines" },
];

async function makePhotos(browser) {
  fs.mkdirSync(DEMO, { recursive: true });
  const page = await browser.newPage();
  const files = {};
  for (const { key } of PHOTOS) {
    const url = await page.evaluate(drawScene, key);
    const bytes = Buffer.from(url.split(",")[1], "base64");
    fs.writeFileSync(path.join(DEMO, `${key}.jpg`), bytes);
    files[key] = bytes;
  }
  await page.close();
  return files;
}

const dayAfter = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

const browser = await launchChrome();
const server = await startServer();
try {
  const photos = await makePhotos(browser);
  const app = { port: Number(new URL(server.baseUrl).port) };

  // Seed: three made-up friends in one group, four items with photos, and a request from Bo on the drill.
  const tess = await signUp(app, "Tess");
  const group = await makeGroup(app, tess, "Maple Street");
  const bo = await signUp(app, "Bo");
  const ines = await signUp(app, "Ines");
  await joinWith(app, bo, group.inviteCode);
  await joinWith(app, ines, group.inviteCode);
  const owners = { Tess: tess, Bo: bo, Ines: ines };
  const ids = {};
  for (const item of PHOTOS) {
    const who = owners[item.owner];
    ids[item.key] = await makeItem(app, who, [group.id], { name: item.name, note: item.note, category: item.category });
    await ok(app, "PUT", `/api/items/${ids[item.key]}/photo`, { token: who.token, raw: photos[item.key], contentType: "image/jpeg" });
  }
  const day = dayAfter(1);
  await ok(app, "POST", `/api/items/${ids.drill}/requests`, { token: bo.token, status: 201, body: { from: day, until: day, message: "Hanging shelves" } });

  const seen = CHANGELOG[0].id;
  const shots = [
    { file: "phone", route: `#/item/${ids.drill}`, ready: "[data-request]" },
    { file: "shelf", route: "#/browse", ready: ".tile" },
  ];
  for (const scheme of ["light", "dark"]) {
    for (const shot of shots) {
      const context = await browser.newContext({
        viewport: PHONE,
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        userAgent: UA,
        colorScheme: scheme,
      });
      await context.addInitScript(
        ([token, group, seenId]) => {
          localStorage.setItem("loaner_token", token);
          localStorage.setItem("loaner_group", group);
          localStorage.setItem("loaner_whats_new_seen", seenId);
          // The kit's install banner would sit on top of the screenshot. This is its "closed" flag.
          sessionStorage.setItem("ak-install-prompt-dismissed", "1");
        },
        [tess.token, group.id, seen],
      );
      const page = await context.newPage();
      await page.goto(`${server.baseUrl}/app${shot.route}`);
      await page.locator("nav.ak-tabbar").waitFor();
      await page.locator(shot.ready).first().waitFor();
      await page.waitForFunction(() => {
        const images = [...document.querySelectorAll("img.photo")];
        return images.length > 0 && images.every((img) => img.complete && img.naturalWidth > 0);
      });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);
      const out = path.join(OUT, `${shot.file}-${scheme}.png`);
      fs.writeFileSync(out, await page.screenshot({ type: "png" }));
      console.log("wrote", out);
      await context.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
