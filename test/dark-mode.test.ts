import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file: string) => fs.readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8");
const tokens = read("css/tokens.css");

/** The body of the first block whose selector line matches, found by brace counting. */
function block(css: string, opener: RegExp): string {
  const start = opener.exec(css);
  assert.ok(start, `missing ${opener}`);
  let depth = 1;
  let i = start.index + start[0].length;
  const from = i;
  while (depth > 0 && i < css.length) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") depth -= 1;
    i += 1;
  }
  return css.slice(from, i - 1);
}

const vars = (body: string) => Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

const darkMedia = block(tokens, /@media \(prefers-color-scheme: dark\) \{/);
const light = vars(block(tokens, /:root \{/));
const dark = vars(block(darkMedia, /:root \{/));

const channel = (hex: string, at: number) => {
  const v = parseInt(hex.slice(at, at + 2), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("tokens.css sets color-scheme light dark and redefines the colour tokens for dark", () => {
  assert.match(block(tokens, /:root \{/), /color-scheme:\s*light dark;/);
  assert.match(darkMedia, /color-scheme:\s*light dark;/);
  for (const name of ["bg", "card", "ink", "ink-inverse", "muted", "line", "line-strong", "soft", "teal-ink", "teal-soft", "amber-ink", "amber-soft", "red", "red-soft", "grey-ink", "grey-soft", "scrim"]) {
    assert.ok(dark[name], `--${name} is redefined in the dark block`);
  }
});

test("the dark block changes colours only, not space, type or shape", () => {
  for (const name of Object.keys(dark)) {
    assert.ok(!/^(s\d|gutter|fs-|r-|font|mono|tab-h|bar-h)/.test(name), `--${name} should not be in the dark block`);
  }
  assert.match(darkMedia, /--teal-ink:\s*#/);
});

test("light mode did not drift", () => {
  assert.equal(light.bg, "#ffffff");
  assert.equal(light.card, "#ffffff");
  assert.equal(light.ink, "#222222");
  assert.equal(light["ink-inverse"], "#ffffff");
  assert.equal(light.muted, "#717171");
  assert.equal(light.teal, "#00857a");
  assert.equal(light["teal-ink"], "#006b62");
  assert.equal(light["teal-soft"], "#e3f3f1");
});

test("dark surfaces are dark, ink is light, and the teal brand is still teal", () => {
  assert.ok(luminance(dark.bg) < 0.03, "dark bg is near black");
  assert.ok(luminance(dark.card) < 0.05, "dark card is dark");
  assert.ok(luminance(dark["teal-soft"]) < 0.06, "teal wash is dark");
  assert.ok(luminance(dark.ink) > 0.7, "dark ink is light");
  assert.notEqual(dark.ink.toLowerCase(), "#ffffff", "off-white, not pure white");
  assert.ok(dark["teal-ink"] !== light["teal-ink"]);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(dark["teal-ink"].slice(i, i + 2), 16));
  assert.ok(g > r && b > r, "teal ink stays teal");
});

test("text tokens meet WCAG AA on their surfaces in both schemes", () => {
  const schemes = { light, dark } as const;
  for (const [scheme, t] of Object.entries(schemes)) {
    // Light --muted on --soft is 4.44:1 on main already (the empty photo placeholder). Light must not drift, so only dark checks --soft.
    for (const surface of scheme === "dark" ? ["bg", "card", "soft"] : ["bg", "card"]) {
      for (const ink of ["ink", "muted", "teal-ink"]) {
        assert.ok(contrast(t[ink], t[surface]) >= 4.5, `${scheme}: --${ink} on --${surface} is ${contrast(t[ink], t[surface]).toFixed(2)}`);
      }
    }
    assert.ok(contrast(t["ink-inverse"], t.ink) >= 4.5, `${scheme}: primary button text`);
    assert.ok(contrast(t["teal-ink"], t["teal-soft"]) >= 4.5, `${scheme}: approved pill`);
    assert.ok(contrast(t["amber-ink"], t["amber-soft"]) >= 4.5, `${scheme}: pending pill`);
    assert.ok(contrast(t.red, t["red-soft"]) >= 4.5, `${scheme}: late pill`);
    assert.ok(contrast(t["grey-ink"], t["grey-soft"]) >= 4.5, `${scheme}: grey pill`);
    assert.ok(contrast(t.red, t.bg) >= 4.5, `${scheme}: red text on bg`);
    assert.ok(contrast(t["ink-inverse"], t.red) >= 4.5, `${scheme}: error toast`);
  }
  // Links and the "Free to borrow" text use --teal as text, and the badge puts inverse ink on it.
  assert.ok(contrast(dark.teal, dark.bg) >= 4.5 && contrast(dark.teal, dark.card) >= 4.5, "dark --teal text");
  assert.ok(contrast(dark["ink-inverse"], dark.teal) >= 4.5, "dark badge text");
  // Borders and the focus ring are UI graphics: 3:1 on the page.
  assert.ok(contrast(dark["line-strong"], dark.bg) >= 3, "dark control border");
  assert.ok(contrast(dark.ink, dark.bg) >= 3, "dark focus ring (ink on bg)");
});

test("no leftover hardcoded UI colours outside the tokens and the camera", () => {
  const checks: [string, RegExp][] = [
    ["css/layout.css", /#ddd\b|#fff\b/],
    ["css/items.css", /#fff\b/],
    ["css/feedback.css", /#fff\b/],
    ["css/sheet.css", /rgba\(34, 34, 34/],
  ];
  for (const [file, pattern] of checks) assert.doesNotMatch(read(file), pattern, file);
  assert.match(read("css/layout.css"), /\.badge\s*\{[^}]*color:\s*var\(--ink-inverse\)/);
  assert.match(read("css/feedback.css"), /\.toast\.error\s*\{[^}]*color:\s*var\(--ink-inverse\)/);
  assert.match(read("css/sheet.css"), /\.scrim\s*\{[^}]*background:\s*var\(--scrim\)/);
});

test("the camera stays dark and is not reassigned in the dark block", () => {
  assert.ok(!("cam-bg" in dark) && !("cam-ink" in dark));
  assert.equal(light["cam-bg"], "#0b0f0f");
  assert.equal(light["cam-ink"], "#ffffff");
  assert.match(read("css/camera.css"), /\.camera\s*\{[^}]*background:\s*var\(--cam-bg\)/);
  assert.ok(luminance(light["cam-bg"]) < 0.02);
});

test("index.html declares both colour schemes and a theme-color for each", () => {
  const html = read("index.html");
  assert.match(html, /<meta name="color-scheme" content="light dark">/);
  const metas = [...html.matchAll(/<meta name="theme-color"[^>]*>/g)].map((m) => m[0]);
  assert.equal(metas.length, 2);
  const lightMeta = metas.find((m) => m.includes("prefers-color-scheme: light"));
  const darkMeta = metas.find((m) => m.includes("prefers-color-scheme: dark"));
  assert.match(lightMeta ?? "", /content="#00857A"/);
  assert.match(darkMeta ?? "", /content="#0F1C1F"/i);
  assert.equal(/content="([^"]+)"/.exec(darkMeta ?? "")?.[1].toLowerCase(), dark.bg.toLowerCase(), "dark theme-color matches the dark --bg");
});

test("logo.svg keeps the light ink and teal arrow, and lightens only the lettering in dark", () => {
  const svg = read("logo.svg");
  const letters = [...svg.matchAll(/<path class="ink" fill="#1A2E33"/g)];
  assert.equal(letters.length, 7, "all seven letter paths carry the ink class and the light-mode fill");
  assert.match(svg, /@media \(prefers-color-scheme: dark\)\s*\{\s*\.ink\s*\{\s*fill:\s*#E8F0F0;\s*\}\s*\}/);
  const darkFill = /\.ink\s*\{\s*fill:\s*(#[0-9A-Fa-f]{6})/.exec(svg)?.[1] ?? "";
  assert.ok(contrast(darkFill, dark.bg) >= 4.5, "dark lettering is readable on the dark page");
  assert.match(svg, /<stop offset="0%" stop-color="#2BB3A3"\/>/);
  assert.match(svg, /<stop offset="100%" stop-color="#00857A"\/>/);
  const arrow = svg.slice(svg.indexOf('<path d="M76.17'));
  assert.ok(!arrow.includes('class="ink"'), "the arrow is not tinted");
  assert.equal([...svg.matchAll(/class="ink"/g)].length, 7);
});

test("the dark mode entry is in What's new", async () => {
  const { CHANGELOG } = (await import(new URL("../public/changelog.js", import.meta.url).href)) as { CHANGELOG: { id: string; date: string; title: string }[] };
  const entry = CHANGELOG.find((item) => item.id === "2026-11-15-dark-mode");
  assert.ok(entry, "the dark mode entry is still listed");
  assert.equal(entry.title, "Dark mode");
});
