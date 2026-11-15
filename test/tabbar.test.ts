import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { byClass, loadKit, type FakeNode } from "./kit-harness.js";

const TABS = [
  { id: "browse", label: "Browse" },
  { id: "alerts", label: "Alerts" },
];

function makeBar() {
  const env = loadKit(["ak-tabbar.js"]);
  const bar = env.window.AppKit.tabbar({ tabs: TABS, active: "browse", label: "Main", badgeLabel: "unread" }) as { el: FakeNode; update: (c: object) => void };
  const badge = () => byClass(bar.el, "ak-badge");
  return { bar, badge };
}

test("the alerts badge names itself from badgeLabel: 3 is '3 unread', 99+ stays 99+, 0 hides it", () => {
  const { bar, badge } = makeBar();
  assert.equal(badge(), null, "no badge at 0");
  bar.update({ badge: { alerts: 3 } });
  assert.equal(badge()?.textContent, "3");
  assert.equal(badge()?.getAttribute("aria-label"), "3 unread");
  assert.equal(badge()?.getAttribute("role"), "img");
  bar.update({ badge: { alerts: 250 } });
  assert.equal(badge()?.textContent, "99+");
  assert.equal(badge()?.getAttribute("aria-label"), "99+ unread");
  bar.update({ badge: { alerts: 0 } });
  assert.equal(badge(), null, "hidden again at 0");
});

test("app.js hands the label to the kit and no longer sets the badge aria-label itself", () => {
  const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(app, /badgeLabel:\s*"unread"/);
  assert.doesNotMatch(app, /setAttribute\("aria-label"/);
  assert.doesNotMatch(app, /\.ak-badge/);
});
