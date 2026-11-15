import assert from "node:assert/strict";
import test from "node:test";
import { byClass, fakeStorage, loadKit, type Env, type EnvOptions } from "./kit-harness.js";

const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0.0.0 Mobile/15E148 Safari/604.1";
const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0";

const OPTIONS = {
  appName: "Loan some",
  iconUrl: "/icons/icon-192.png",
  title: "Install Loan some",
  text: "Add it to your home screen so it is easy to open.",
  closeLabel: "Not now",
  iosNonSafari: "share-steps",
};

/** A fresh browser with the kit's install prompt loaded and started the way app.js starts it. */
function visit(options: EnvOptions = {}): Env {
  const env = loadKit(["install-prompt.js"], options);
  env.window.AppKit.installPrompt.init(OPTIONS);
  return env;
}

const banner = (env: Env) => env.document.getElementById("ak-install-prompt");
const variant = (env: Env) => banner(env)?.getAttribute("data-variant");
const event = (outcome = "accepted") => ({ prompt: () => Promise.resolve(), userChoice: Promise.resolve({ outcome }) });

test("the banner carries the Loan some copy and icon", () => {
  const env = visit({ userAgent: ANDROID });
  const el = banner(env);
  assert.ok(el, "banner is shown");
  assert.equal(el.getAttribute("role"), "region");
  assert.equal(el.getAttribute("aria-label"), "Install Loan some");
  assert.equal(byClass(el, "ak-ip-title")?.textContent, "Install Loan some");
  assert.equal(byClass(el, "ak-ip-text")?.textContent, "Add it to your home screen so it is easy to open.");
  assert.equal(byClass(el, "ak-ip-mark")?.getAttribute("src"), "/icons/icon-192.png");
  assert.equal(byClass(el, "ak-ip-close")?.getAttribute("aria-label"), "Not now");
  assert.equal(env.body.firstChild, el, "it is the first thing on the page");
});

test("hidden when installed: display-mode standalone, fullscreen, and navigator.standalone", () => {
  assert.equal(banner(visit({ userAgent: ANDROID, media: ["(display-mode: standalone)"] })), null);
  assert.equal(banner(visit({ userAgent: ANDROID, media: ["(display-mode: fullscreen)"] })), null, "the kit counts fullscreen as installed");
  assert.equal(banner(visit({ userAgent: IPHONE, standalone: true })), null);
  assert.ok(banner(visit({ userAgent: IPHONE, standalone: false })), "navigator.standalone false is not installed");
  const env = visit({ userAgent: ANDROID, media: ["(display-mode: standalone)"] });
  env.fire("beforeinstallprompt", event());
  assert.equal(banner(env), null, "not even when the install event arrives");
  assert.equal(env.window.AppKit.installPrompt.isInstalled(), true);
});

test("iOS: share steps on iPhone Safari and on an iPad that calls itself a Mac, no Install button", () => {
  for (const options of [{ userAgent: IPHONE }, { userAgent: IPAD, maxTouchPoints: 5 }]) {
    const env = visit(options);
    assert.equal(variant(env), "ios");
    const el = banner(env);
    assert.ok(byClass(el, "ak-ip-steps"), "share steps");
    assert.equal(byClass(el, "ak-ip-install"), null, "iOS never gets an Install button");
    assert.match(byClass(el, "ak-ip-steps")?.textContent ?? "", /Tap Share/);
    assert.match(byClass(el, "ak-ip-steps")?.textContent ?? "", /Add to Home Screen/);
  }
  const mac = visit({ userAgent: IPAD, maxTouchPoints: 0 });
  assert.equal(variant(mac), "generic", "a real Mac has no touch points");
});

test("iOS in another browser (Chrome) gets the share steps too, not a hint to open Safari", () => {
  const env = visit({ userAgent: IPHONE_CHROME });
  assert.equal(variant(env), "ios");
  const steps = byClass(banner(env), "ak-ip-steps");
  assert.ok(steps, "share steps");
  assert.match(steps.textContent, /Tap Share/);
  assert.match(steps.textContent, /Add to Home Screen/);
  assert.equal(byClass(banner(env), "ak-ip-install"), null, "no Install button on iOS");
  assert.doesNotMatch(banner(env)?.textContent ?? "", /Open this page in Safari/);
});

test("app.js starts the install prompt with iosNonSafari share-steps", async () => {
  const fs = await import("node:fs");
  const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(app, /iosNonSafari:\s*"share-steps"/);
  assert.equal(OPTIONS.iosNonSafari, "share-steps");
});

test("variants: Install button once beforeinstallprompt is captured, otherwise a browser menu hint", () => {
  const env = visit({ userAgent: ANDROID });
  assert.equal(variant(env), "generic");
  assert.equal(byClass(banner(env), "ak-ip-install"), null, "no event yet means no install button");
  assert.match(byClass(banner(env), "ak-ip-hint")?.textContent ?? "", /browser menu/);
  env.fire("beforeinstallprompt", event());
  assert.equal(variant(env), "install", "the banner redraws when the event arrives late");
  assert.equal(byClass(banner(env), "ak-ip-install")?.textContent, "Install");
  assert.equal(variant(visit({ userAgent: FIREFOX })), "generic");
  const ios = visit({ userAgent: IPHONE });
  ios.fire("beforeinstallprompt", event());
  assert.equal(variant(ios), "ios", "iOS stays on the share steps");
});

test("Install button: accepted removes the banner, dismissed falls back to the hint", async () => {
  const accepted = visit({ userAgent: ANDROID });
  accepted.fire("beforeinstallprompt", event("accepted"));
  byClass(banner(accepted), "ak-ip-install")?.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(banner(accepted), null, "installed, so the banner goes");

  const refused = visit({ userAgent: ANDROID });
  refused.fire("beforeinstallprompt", event("dismissed"));
  byClass(banner(refused), "ak-ip-install")?.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(banner(refused), "still there");
  assert.equal(variant(refused), "generic", "the event works once, so the hint takes over");
});

test("appinstalled removes the banner and it stays away on this page", () => {
  const env = visit({ userAgent: ANDROID });
  assert.ok(banner(env));
  env.fire("appinstalled");
  assert.equal(banner(env), null);
  env.window.AppKit.installPrompt.init(OPTIONS);
  assert.equal(banner(env), null, "init again does not bring it back");
});

test("closing is remembered for the session only: sessionStorage, never localStorage", () => {
  const session = fakeStorage();
  const local = fakeStorage();
  const env = visit({ userAgent: ANDROID, sessionStorage: session.storage, localStorage: local.storage });
  byClass(banner(env), "ak-ip-close")?.click();
  assert.equal(banner(env), null);
  assert.equal(session.data.get("ak-install-prompt-dismissed"), "1");
  assert.deepEqual(local.calls, [], "localStorage is never touched");
  env.window.AppKit.installPrompt.init(OPTIONS);
  assert.equal(banner(env), null, "stays gone while navigating on this page");
  assert.equal(banner(visit({ userAgent: ANDROID, sessionStorage: session.storage })), null, "same session, same tab: still hidden");
  assert.ok(banner(visit({ userAgent: ANDROID, sessionStorage: fakeStorage().storage })), "a new visit has empty sessionStorage, so it shows again");
});

test("blocked storage does not throw, and closing still hides the banner on this page", () => {
  const env = visit({ userAgent: ANDROID, sessionStorage: "blocked", localStorage: "blocked" });
  assert.ok(banner(env), "a blocked read counts as not dismissed");
  assert.doesNotThrow(() => byClass(banner(env), "ak-ip-close")?.click());
  assert.equal(banner(env), null);
  env.window.AppKit.installPrompt.init(OPTIONS);
  assert.equal(banner(env), null, "the in-memory flag keeps it hidden");
});

test("show() forces the banner back after a close, but never when installed", () => {
  const env = visit({ userAgent: ANDROID });
  byClass(banner(env), "ak-ip-close")?.click();
  env.window.AppKit.installPrompt.show();
  assert.ok(banner(env));
  const installed = visit({ userAgent: ANDROID, media: ["(display-mode: standalone)"] });
  installed.window.AppKit.installPrompt.show();
  assert.equal(banner(installed), null);
});
