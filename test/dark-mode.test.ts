import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file: string) => fs.readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8");
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/* A small CSS cascade for custom properties: the kit tokens first, then the Loan some tokens, resolved per scheme. */

type Rule = { media: "light" | "dark" | null; selectors: string[]; vars: Record<string, string>; order: number };

function parse(css: string, firstOrder: number): Rule[] {
  const rules: Rule[] = [];
  let order = firstOrder;
  const walk = (src: string, media: Rule["media"]) => {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf("{", i);
      if (open < 0) break;
      const prelude = src.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (depth > 0 && j < src.length) {
        if (src[j] === "{") depth += 1;
        if (src[j] === "}") depth -= 1;
        j += 1;
      }
      const body = src.slice(open + 1, j - 1);
      i = j;
      if (prelude.startsWith("@media")) walk(body, (/prefers-color-scheme:\s*(light|dark)/.exec(prelude)?.[1] as Rule["media"]) ?? media);
      else if (prelude.startsWith("@")) continue;
      else {
        const vars = Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
        rules.push({ media, selectors: prelude.split(",").map((s) => s.trim()), vars, order: order++ });
      }
    }
  };
  walk(strip(css), null);
  return rules;
}

const kitRules = parse(read("app-kit/ak-tokens.css"), 0);
const loanerRules = parse(read("css/tokens.css"), 1000);
const rules = [...kitRules, ...loanerRules];

/** The custom properties that win for a phone in `phone` mode, with the page optionally forcing `forced` through data-ak-scheme. */
function cascade(phone: "light" | "dark", forced?: "light" | "dark"): Record<string, string> {
  const applied: { spec: number; order: number; vars: Record<string, string> }[] = [];
  for (const rule of rules) {
    if (rule.media && rule.media !== phone) continue;
    let spec = -1;
    for (const selector of rule.selectors) {
      if (selector === ":root") spec = Math.max(spec, 10);
      else if (forced && selector === `html[data-ak-scheme="${forced}"]`) spec = Math.max(spec, 11);
    }
    if (spec >= 0) applied.push({ spec, order: rule.order, vars: rule.vars });
  }
  applied.sort((a, b) => a.spec - b.spec || a.order - b.order);
  return Object.assign({}, ...applied.map((a) => a.vars));
}

function resolve(vars: Record<string, string>, name: string): string {
  const value = vars[`--${name}`];
  assert.ok(value !== undefined, `--${name} is not defined`);
  return value.replace(/var\((--[\w-]+)\)/g, (_all, ref: string) => resolve(vars, ref.slice(2)));
}

const light = cascade("light");
const dark = cascade("dark");
const L = (name: string) => resolve(light, name);
const D = (name: string) => resolve(dark, name);
const pick = (scheme: "light" | "dark") => (name: string) => (scheme === "light" ? L(name) : D(name));

const channel = (hex: string, at: number) => {
  const v = parseInt(hex.slice(at, at + 2), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
function luminance(hex: string): number {
  assert.match(hex, /^#[0-9a-f]{6}$/i, `${hex} is a hex colour`);
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const USED = [
  "bg", "card", "ink", "muted", "line", "line-strong", "soft", "fill", "fill-ink", "teal", "teal-ink", "teal-soft",
  "amber-ink", "amber-soft", "red", "red-soft", "grey-ink", "grey-soft", "chip-line", "scrim", "font",
  "ak-accent", "ak-accent-2", "ak-accent-strong", "ak-accent-ink", "ak-tab",
];

test("the Loan some tokens load after the kit tokens and only recolour (and set the font) inside the scheme blocks", () => {
  const allowed = /^--(ak-(accent|accent-2|accent-strong|accent-ink|font)|line-strong|teal-ink|teal-soft|amber-ink|amber-soft|red-soft)$/;
  const schemeBlocks = loanerRules.filter((rule) => rule.media || rule.selectors.some((s) => s.startsWith("html[data-ak-scheme")));
  assert.ok(schemeBlocks.length >= 3, "dark, light media and forced light blocks");
  for (const rule of schemeBlocks) {
    for (const name of Object.keys(rule.vars)) assert.match(name, allowed, `${name} does not belong in a scheme block (space, type and shape stay the same in both)`);
  }
  const names = ["--ak-accent", "--ak-accent-2", "--ak-accent-strong", "--ak-accent-ink", "--line-strong", "--teal-ink", "--teal-soft", "--amber-ink", "--amber-soft", "--red-soft"];
  for (const rule of schemeBlocks) {
    for (const name of names) assert.ok(name in rule.vars, `${rule.selectors.join(", ")} sets ${name}`);
  }
});

test("a page that forces a scheme gets the same colours as a phone in that scheme", () => {
  const same = (a: Record<string, string>, b: Record<string, string>, label: string) => {
    for (const name of USED) assert.equal(resolve(a, name), resolve(b, name), `${label}: --${name}`);
  };
  same(cascade("dark", "light"), light, "forced light on a dark phone");
  same(cascade("light", "dark"), dark, "forced dark on a light phone");
});

test("the teal accent and Inter font survive the kit, and the old names alias the kit tokens", () => {
  assert.equal(L("ak-accent"), "#00857a");
  assert.equal(L("ak-accent-2"), "#00857a");
  assert.equal(L("ak-accent-strong"), "#00857a");
  assert.equal(L("ak-accent-ink"), "#ffffff");
  assert.equal(D("ak-accent"), "#2bb3a3");
  assert.equal(D("ak-accent-2"), "#2bb3a3");
  assert.equal(D("ak-accent-strong"), "#2bb3a3");
  assert.equal(D("ak-accent-ink"), "#000000");
  for (const t of [L, D]) {
    assert.match(t("font"), /^Inter, /);
    assert.equal(t("teal"), t("ak-accent"));
    assert.equal(t("bg"), t("ak-bg"));
    assert.equal(t("card"), t("ak-surface"));
    assert.equal(t("ink"), t("ak-text"));
    assert.equal(t("fill"), t("ak-btn-fill"));
    assert.equal(t("fill-ink"), t("ak-btn-ink"));
    assert.equal(t("scrim"), t("ak-scrim"));
  }
  assert.equal(L("bg"), "#ffffff");
  assert.equal(L("ink"), "#000000");
  assert.equal(L("teal-ink"), "#006b62");
  assert.equal(L("teal-soft"), "#e3f3f1");
  assert.equal(D("bg"), "#000000");
  assert.equal(D("ink"), "#ffffff");
  assert.match(read("css/tokens.css"), /font-family:\s*"Inter"/, "the Inter font face is still declared");
});

test("dark surfaces are dark, ink is light, and the teal brand is still teal", () => {
  assert.ok(luminance(D("bg")) < 0.03, "dark bg is near black");
  assert.ok(luminance(D("card")) < 0.05, "dark card is dark");
  assert.ok(luminance(D("soft")) < 0.05, "dark soft surface is dark");
  assert.ok(luminance(D("teal-soft")) < 0.06, "teal wash is dark");
  assert.ok(luminance(D("ink")) > 0.7, "dark ink is light");
  assert.ok(luminance(L("bg")) > 0.9 && luminance(L("ink")) < 0.05, "light is light");
  assert.notEqual(D("teal-ink"), L("teal-ink"));
  for (const hex of [D("teal-ink"), L("teal-ink"), D("teal"), L("teal")]) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    assert.ok(g > r && b > r, `${hex} stays teal`);
  }
});

test("text tokens meet WCAG AA on their surfaces in both schemes", () => {
  for (const scheme of ["light", "dark"] as const) {
    const t = pick(scheme);
    const check = (fg: string, bg: string, min = 4.5) => {
      const value = contrast(t(fg), t(bg));
      assert.ok(value >= min, `${scheme}: --${fg} on --${bg} is ${value.toFixed(2)}, needs ${min}`);
    };
    for (const surface of ["bg", "card", "soft"]) for (const ink of ["ink", "muted", "teal-ink"]) check(ink, surface);
    for (const surface of ["bg", "card"]) {
      check("teal", surface); // links, "Free to borrow", due dates
      check("red", surface); // error text, danger buttons
    }
    check("fill-ink", "fill"); // primary button, lent badge, lent pill, own message bubble, chip on
    check("ak-accent-ink", "ak-accent"); // tab badge, install button, avatar-style accent fills
    check("ink", "teal-soft"); // install banner text
    check("teal-ink", "teal-soft"); // approved pill, install banner hint
    check("amber-ink", "amber-soft"); // pending pill
    check("red", "red-soft"); // overdue pill
    check("grey-ink", "grey-soft"); // grey pills
    // Borders and the focus ring are UI graphics: 3:1 on the page.
    check("line-strong", "bg", 3);
    check("ink", "bg", 3);
  }
});

test("the kit's own muted and danger text reach AA, so Loan some does not override them", () => {
  const kitScheme = (scheme: "light" | "dark") =>
    Object.assign({}, ...kitRules.filter((r) => r.selectors.includes(":root") && (r.media === null || r.media === scheme)).map((r) => r.vars));
  for (const scheme of ["light", "dark"] as const) {
    const kit = kitScheme(scheme);
    const t = pick(scheme);
    // The surfaces text sits on: page, card, soft panel, and the error toast (kit --ak-surface-2).
    for (const surface of [t("bg"), t("card"), t("soft"), kit["--ak-surface-2"]]) {
      for (const name of ["--ak-muted", "--ak-danger"]) {
        const value = contrast(kit[name], surface);
        assert.ok(value >= 4.5, `${scheme}: kit ${name} on ${surface} is ${value.toFixed(2)}`);
      }
    }
    // Loan some uses the kit values as they are.
    assert.equal(t("muted"), kit["--ak-muted"], `${scheme}: muted is the kit's`);
    assert.equal(t("red"), kit["--ak-danger"], `${scheme}: danger is the kit's`);
  }
  for (const rule of loanerRules) {
    assert.ok(!("--ak-muted" in rule.vars) && !("--ak-danger" in rule.vars), "tokens.css does not override muted or danger");
  }
});

test("every custom property the Loan some stylesheets read is defined somewhere", () => {
  const declared = new Set<string>();
  const files = [...fs.readdirSync(new URL("../public/css/", import.meta.url)).map((f) => `css/${f}`), ...fs.readdirSync(new URL("../public/app-kit/", import.meta.url)).filter((f) => f.endsWith(".css")).map((f) => `app-kit/${f}`)];
  for (const file of files) for (const m of strip(read(file)).matchAll(/(--[\w-]+)\s*:/g)) declared.add(m[1]);
  const missing: string[] = [];
  for (const file of files.filter((f) => f.startsWith("css/"))) {
    for (const m of strip(read(file)).matchAll(/var\((--[\w-]+)/g)) if (!declared.has(m[1])) missing.push(`${file}: ${m[1]}`);
  }
  assert.deepEqual(missing, []);
});

test("nothing still uses the pre-kit names, and no UI colours are hardcoded outside the tokens and the camera", () => {
  for (const file of fs.readdirSync(new URL("../public/css/", import.meta.url))) {
    const css = strip(read(`css/${file}`));
    assert.doesNotMatch(css, /--ink-inverse/, `${file} still uses --ink-inverse`);
    assert.doesNotMatch(css, /(^|[\s,}])#(install-prompt|toasts)\b/, `${file} styles a removed id`);
    assert.doesNotMatch(css, /(^|[\s,}])\.(tabbar|toast|badge|scrim|sheet|sheet-head|sheet-scroll|sheet-dock|grabber|ip-[a-z]+)\b/, `${file} styles a removed class`);
  }
  for (const [file, pattern] of [["css/layout.css", /#ddd\b|#fff\b/], ["css/items.css", /#fff\b/], ["css/feedback.css", /#fff\b/], ["css/sheet.css", /rgba\(34, 34, 34/]] as const) {
    assert.doesNotMatch(read(file), pattern, file);
  }
  assert.match(strip(read("css/layout.css")), /\.ak-tabbar \.ak-badge\s*\{[^}]*color:\s*var\(--ak-accent-ink\)/, "the tab badge text is the accent ink");
  assert.doesNotMatch(strip(read("css/feedback.css")), /\.ak-toast-(error|danger)/, "the kit's error toast colour passes AA, so there is no loaner override");
  assert.match(strip(read("css/feedback.css")), /#ak-toasts\s*\{[^}]*pointer-events:\s*none/, "toasts never catch taps");
});

test("the kit's own sheet layer sits above its tab bar, so Loan some needs no z-index override", () => {
  const components = strip(read("app-kit/ak-components.css"));
  const tokens = strip(read("app-kit/ak-tokens.css"));
  const zToken = (name: string) => Number(new RegExp(`--${name}:\\s*(\\d+)`).exec(tokens)?.[1]);
  const zOf = (selector: string, token: string) => {
    const rule = new RegExp(`${selector.replace(".", "\\.")}\\s*\\{[^}]*z-index:\\s*var\\(--${token}(?:,\\s*(\\d+))?\\)`).exec(components);
    assert.ok(rule, `${selector} reads --${token}`);
    return { token: zToken(token), fallback: Number(rule[1]) };
  };
  const layer = zOf(".ak-sheet-layer", "ak-z-sheet-layer");
  const bar = zOf(".ak-tabbar", "ak-z-tabbar");
  assert.ok(layer.token > bar.token, `sheet layer ${layer.token} is above the tab bar ${bar.token}`);
  assert.ok(layer.fallback > bar.fallback, "and so are the fallbacks");
  assert.ok(zToken("ak-z-toast") > layer.token, "toasts sit above the sheet layer");
  assert.doesNotMatch(strip(read("css/sheet.css")), /\.ak-sheet-layer\s*\{[^}]*z-index/, "no loaner override of the sheet layer z-index");
  assert.doesNotMatch(strip(read("css/layout.css")), /\.ak-tabbar\s*\{[^}]*z-index/, "no loaner override of the tab bar z-index");
});

test("the camera stays dark and is not reassigned in any scheme block", () => {
  for (const rule of rules) assert.ok(!("--cam-bg" in rule.vars && (rule.media || rule.selectors.some((s) => s.startsWith("html[")))), "cam-bg is only in the base block");
  assert.equal(L("cam-bg"), "#0b0f0f");
  assert.equal(L("cam-ink"), "#ffffff");
  assert.equal(D("cam-bg"), "#0b0f0f");
  assert.match(read("css/camera.css"), /\.camera\s*\{[^}]*background:\s*var\(--cam-bg\)/);
  assert.match(read("css/camera.css"), /html:has\(\.camera\)\.ak-status-strip body::before\s*\{\s*display:\s*none/, "the status strip is hidden over the camera");
  assert.ok(luminance(L("cam-bg")) < 0.02);
});

test("index.html loads the kit in order, has the four theme-color metas, and the head metas the kit asks for", () => {
  const html = read("index.html");
  assert.match(html, /<html lang="en" class="ak-status-strip">/);
  assert.doesNotMatch(html, /eink/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">/);
  assert.match(html, /<meta name="color-scheme" content="light dark">/);
  assert.match(html, /<meta name="mobile-web-app-capable" content="yes">/);
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.match(html, /<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">/);
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest\?v=1">/);

  const metas = [...html.matchAll(/<meta name="theme-color"[^>]*>/g)].map((m) => m[0]);
  const expected = [
    ["(prefers-color-scheme: dark) and (max-width: 719px)", D("bg")],
    ["(prefers-color-scheme: light) and (max-width: 719px)", L("bg")],
    ["(prefers-color-scheme: dark)", D("bg")],
    ["(prefers-color-scheme: light)", L("bg")],
  ];
  assert.equal(metas.length, 4, "four static theme-color metas (the kit replaces them with one at runtime)");
  metas.forEach((meta, i) => {
    assert.equal(/media="([^"]+)"/.exec(meta)?.[1], expected[i][0], `meta ${i + 1} media`);
    assert.equal(/content="([^"]+)"/.exec(meta)?.[1].toLowerCase(), expected[i][1], `meta ${i + 1} colour is the page background`);
  });

  const sheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(sheets.slice(0, 5), ["/app-kit/ak-tokens.css", "/app-kit/app-kit.css", "/app-kit/ak-components.css", "/app-kit/install-prompt.css", "/css/tokens.css"], "kit first, then the Loan some tokens for overrides");
  assert.ok(!sheets.includes("/app-kit/ak-base.css"), "ak-base.css is not used");
  assert.ok(sheets.indexOf("/css/base.css") > sheets.indexOf("/css/tokens.css"));

  const scripts = [...html.matchAll(/<script ([^>]*)src="([^"]+)"/g)].map((m) => ({ src: m[2], module: /type="module"/.test(m[1]) }));
  assert.deepEqual(
    scripts.map((s) => s.src),
    ["/app-kit/theme-color.js", "/app-kit/install-prompt.js", "/app-kit/ak-dom.js", "/app-kit/ak-nav.js", "/app-kit/ak-sheet.js", "/app-kit/ak-tabbar.js", "/app-kit/ak-toast.js", "/app.js"],
  );
  assert.deepEqual(scripts.filter((s) => s.module).map((s) => s.src), ["/app.js"], "only app.js is a module, so the kit scripts run first");
  assert.doesNotMatch(html, /id="toasts"/, "the kit makes #ak-toasts itself");
  assert.match(read("css/base.css"), /html\s*\{[^}]*background:\s*var\(--bg\)/, "html paints --bg behind the status bar inset");
});

test("the manifest colours are the dark page colour", () => {
  const manifest = JSON.parse(read("manifest.webmanifest")) as { theme_color: string; background_color: string };
  assert.equal(manifest.theme_color.toLowerCase(), D("bg"));
  assert.equal(manifest.background_color.toLowerCase(), D("bg"));
});

test("logo.svg keeps the light ink and teal arrow, and lightens only the lettering in dark", () => {
  const svg = read("logo.svg");
  const letters = [...svg.matchAll(/<path class="ink" fill="#1A2E33"/g)];
  assert.equal(letters.length, 7, "all seven letter paths carry the ink class and the light-mode fill");
  assert.match(svg, /@media \(prefers-color-scheme: dark\)\s*\{\s*\.ink\s*\{\s*fill:\s*#E8F0F0;\s*\}\s*\}/);
  const darkFill = /\.ink\s*\{\s*fill:\s*(#[0-9A-Fa-f]{6})/.exec(svg)?.[1] ?? "";
  assert.ok(contrast(darkFill, D("bg")) >= 4.5, "dark lettering is readable on the dark page");
  assert.ok(contrast("#1A2E33", L("bg")) >= 4.5, "light lettering is readable on the light page");
  assert.match(svg, /<stop offset="0%" stop-color="#2BB3A3"\/>/);
  assert.match(svg, /<stop offset="100%" stop-color="#00857A"\/>/);
  const arrow = svg.slice(svg.indexOf('<path d="M76.17'));
  assert.ok(!arrow.includes('class="ink"'), "the arrow is not tinted");
  assert.equal([...svg.matchAll(/class="ink"/g)].length, 7);
});

test("the dark mode and app kit entries are in What's new", async () => {
  const { CHANGELOG } = (await import(new URL("../public/changelog.js", import.meta.url).href)) as { CHANGELOG: { id: string; date: string; title: string; bullets: string[] }[] };
  const dark = CHANGELOG.find((item) => item.id === "2026-11-15-dark-mode");
  assert.ok(dark, "the dark mode entry is kept");
  assert.equal(dark.title, "Dark mode");
  const kit = CHANGELOG.find((item) => item.id === "2026-11-15-app-kit");
  assert.ok(kit, "the app kit entry is kept");
  assert.equal(CHANGELOG[0].id, "2026-11-15-app-kit-v030", "the newest entry is the app kit v0.3.0 one");
  assert.ok(CHANGELOG.some((item) => item.id === "2026-11-15-notification-tap"), "the notification tap entry is kept");
  assert.ok(CHANGELOG[0].title.length <= 60);
  assert.ok(!/\u2014/.test([CHANGELOG[0].title, ...CHANGELOG[0].bullets].join(" ")), "no em dashes");
});
