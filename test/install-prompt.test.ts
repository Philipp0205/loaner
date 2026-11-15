import assert from "node:assert/strict";
import test from "node:test";

type Win = {
  navigator?: { userAgent?: string; maxTouchPoints?: number; standalone?: boolean };
  matchMedia?: (query: string) => { matches: boolean };
  sessionStorage?: Storage;
  localStorage?: Storage;
};
type Helpers = {
  DISMISS_KEY: string;
  isStandalone: (win: Win) => boolean;
  isIos: (win: Win) => boolean;
  isDismissed: (win: Win) => boolean;
  setDismissed: (win: Win) => void;
  pickVariant: (win: Win, deferred: unknown) => "install" | "ios" | "generic";
  shouldShow: (win: Win, installedThisPage?: boolean) => boolean;
};

// The module does no DOM work at import time, so node can load it directly.
const { DISMISS_KEY, isStandalone, isIos, isDismissed, setDismissed, pickVariant, shouldShow } = (await import(
  new URL("../public/install-prompt.js", import.meta.url).href
)) as Helpers;

const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0";

const media = (standalone: boolean) => (query: string) => ({ matches: standalone && query === "(display-mode: standalone)" });
const win = (userAgent: string, extra: Partial<Win> = {}, nav: { maxTouchPoints?: number; standalone?: boolean } = {}): Win => ({
  navigator: { userAgent, ...nav },
  matchMedia: media(false),
  ...extra,
});

/** A Storage stand-in that records every call. */
function fakeStorage() {
  const data = new Map<string, string>();
  const calls: string[] = [];
  const storage = {
    getItem: (key: string) => (calls.push(`get ${key}`), data.get(key) ?? null),
    setItem: (key: string, value: string) => (calls.push(`set ${key}`), void data.set(key, value)),
  };
  return { storage: storage as unknown as Storage, calls, data };
}

test("isStandalone is true for display-mode standalone and for navigator.standalone", () => {
  assert.equal(isStandalone(win(ANDROID, { matchMedia: media(true) })), true);
  assert.equal(isStandalone(win(IPHONE, {}, { standalone: true })), true);
  assert.equal(isStandalone(win(ANDROID)), false);
  assert.equal(isStandalone(win(IPHONE, {}, { standalone: false })), false);
  assert.equal(isStandalone({}), false);
  assert.equal(isStandalone({ matchMedia: () => { throw new Error("boom"); } }), false);
});

test("isIos detects iPhone Safari and iPad (Macintosh with touch), not Android Chrome or desktop", () => {
  assert.equal(isIos(win(IPHONE)), true);
  assert.equal(isIos(win(IPAD, {}, { maxTouchPoints: 5 })), true);
  assert.equal(isIos(win(IPAD, {}, { maxTouchPoints: 0 })), false, "a real Mac has no touch points");
  assert.equal(isIos(win(ANDROID, {}, { maxTouchPoints: 5 })), false);
  assert.equal(isIos(win(FIREFOX)), false);
  assert.equal(isIos({}), false);
});

test("the dismissed flag lives in sessionStorage and never touches localStorage", () => {
  assert.equal(DISMISS_KEY, "loaner_install_prompt_dismissed");
  const session = fakeStorage();
  const local = fakeStorage();
  const w = win(ANDROID, { sessionStorage: session.storage, localStorage: local.storage });
  assert.equal(isDismissed(w), false);
  setDismissed(w);
  assert.equal(session.data.get(DISMISS_KEY), "1");
  assert.equal(isDismissed(w), true);
  assert.deepEqual(local.calls, []);
  // A new visit has empty sessionStorage, so it shows again.
  assert.equal(isDismissed(win(ANDROID, { sessionStorage: fakeStorage().storage })), false);
});

test("blocked storage does not throw", () => {
  const blocked = {
    getItem: () => { throw new Error("blocked"); },
    setItem: () => { throw new Error("blocked"); },
  } as unknown as Storage;
  const w = win(ANDROID, { sessionStorage: blocked });
  assert.equal(isDismissed(w), false);
  assert.doesNotThrow(() => setDismissed(w));
});

test("pickVariant: install button with a captured event, share steps on iOS, a generic hint otherwise", () => {
  const event = { prompt: () => Promise.resolve() };
  assert.equal(pickVariant(win(ANDROID), event), "install");
  assert.equal(pickVariant(win(ANDROID), null), "generic", "no event yet means no install button");
  assert.equal(pickVariant(win(IPHONE), null), "ios");
  assert.equal(pickVariant(win(IPHONE), event), "ios", "iOS never gets an Install button");
  assert.equal(pickVariant(win(IPAD, {}, { maxTouchPoints: 5 }), null), "ios");
  assert.equal(pickVariant(win(FIREFOX), null), "generic");
  assert.equal(pickVariant(win(FIREFOX), {}), "generic", "an object without prompt() is not usable");
});

test("shouldShow is false when installed, dismissed this session, or after appinstalled", () => {
  const fresh = () => win(ANDROID, { sessionStorage: fakeStorage().storage });
  assert.equal(shouldShow(fresh()), true);
  assert.equal(shouldShow(fresh(), true), false);
  assert.equal(shouldShow(win(ANDROID, { matchMedia: media(true), sessionStorage: fakeStorage().storage })), false);
  assert.equal(shouldShow(win(IPHONE, { sessionStorage: fakeStorage().storage }, { standalone: true })), false);
  const dismissed = fresh();
  setDismissed(dismissed);
  assert.equal(shouldShow(dismissed), false);
});
