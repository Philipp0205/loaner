import assert from "node:assert/strict";
import test from "node:test";
import { byClass, loadKit } from "./kit-harness.js";

/** AppKit.pullToRefresh itself, driven by touch events on a fake document. The threshold is 70 like the app. */

const THRESHOLD = 70;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  const env = loadKit(["ak-native.js"]);
  const calls: string[] = [];
  let finish: { resolve: () => void; reject: (error: Error) => void } = { resolve() {}, reject() {} };
  const handle = env.window.AppKit.pullToRefresh({
    threshold: THRESHOLD,
    onRefresh: () => {
      calls.push("refresh");
      return new Promise<void>((resolve, reject) => { finish = { resolve, reject }; });
    },
  });
  const indicator = () => byClass(env.body, "ak-ptr");
  const vars = () => ({ y: indicator()?.style["--ak-ptr-y"], progress: indicator()?.style["--ak-ptr-progress"] });
  /** One finger down at (100, 100), moved `dy` down and `dx` across, then lifted if `lift`. Returns the last move event. */
  const pull = (dy: number, { dx = 0, lift = true } = {}) => {
    env.touch("touchstart", [[100, 100]]);
    const move = env.touch("touchmove", [[100 + dx, 100 + dy]]);
    if (lift) env.touch("touchend");
    return move;
  };
  return { env, calls, handle, indicator, vars, pull, finish: () => finish };
}

test("a pull does not start while the page is scrolled down", () => {
  const { env, calls, indicator, pull } = setup();
  env.scroller.scrollTop = 120;
  const move = pull(200);
  assert.equal(indicator(), null, "no indicator is made");
  assert.equal(move.defaultPrevented, false, "the page keeps scrolling");
  assert.deepEqual(calls, []);
});

test("a pull that starts at the top but is mostly sideways, or upward, is ignored", () => {
  const { calls, indicator, pull } = setup();
  pull(40, { dx: 90 });
  assert.equal(indicator(), null, "sideways");
  pull(-40);
  assert.equal(indicator(), null, "upward");
  assert.deepEqual(calls, []);
});

test("the indicator follows the finger with resistance and stops at its maximum", () => {
  const { env, indicator, vars, pull } = setup();
  const move = pull(40, { lift: false });
  assert.equal(move.defaultPrevented, true, "the page does not scroll under the pull");
  assert.ok(indicator()!.hasClass("ak-ptr"));
  assert.ok(indicator()!.hasClass("ak-ptr-pulling"), "no transition while the finger is down");
  assert.equal(vars().y, "20px", "half the finger travel");
  assert.equal(Number(vars().progress).toFixed(3), (40 / THRESHOLD).toFixed(3));
  env.touch("touchmove", [[100, 100 + 400]]);
  assert.equal(vars().y, "80px", "capped");
  assert.equal(vars().progress, "1");
  assert.ok(indicator()!.parentNode === env.body, "the indicator sits on body");
});

test("a pull below the threshold hides the indicator and does not refresh", () => {
  const { calls, indicator, vars, pull } = setup();
  pull(THRESHOLD - 1);
  assert.deepEqual(calls, []);
  assert.ok(!indicator()!.hasClass("ak-ptr-pulling"));
  assert.ok(!indicator()!.hasClass("ak-ptr-loading"));
  assert.deepEqual(vars(), { y: "0px", progress: "0" });
});

test("a pull past the threshold refreshes, shows the loading spinner, and hides when the promise resolves", async () => {
  const { calls, indicator, vars, pull, finish } = setup();
  pull(THRESHOLD);
  assert.deepEqual(calls, ["refresh"], "exactly at the threshold counts");
  assert.ok(indicator()!.hasClass("ak-ptr-loading"));
  assert.ok(!indicator()!.hasClass("ak-ptr-pulling"));
  assert.equal(vars().y, "52px", "it rests under the top edge while loading");
  finish().resolve();
  await settle();
  assert.ok(!indicator()!.hasClass("ak-ptr-loading"), "hidden once the promise settles");
  assert.deepEqual(vars(), { y: "0px", progress: "0" });
});

test("the indicator also hides when the refresh rejects, and the next pull works", async () => {
  const { calls, indicator, pull, finish } = setup();
  pull(90);
  finish().reject(new Error("offline"));
  await settle();
  assert.ok(!indicator()!.hasClass("ak-ptr-loading"));
  pull(90);
  assert.deepEqual(calls, ["refresh", "refresh"]);
});

test("a second pull is ignored while a refresh is running", async () => {
  const { env, calls, indicator, vars, pull, finish } = setup();
  pull(90);
  assert.deepEqual(calls, ["refresh"]);
  const move = pull(120);
  assert.deepEqual(calls, ["refresh"], "no second refresh");
  assert.equal(move.defaultPrevented, false, "the second touch is left alone");
  assert.ok(indicator()!.hasClass("ak-ptr-loading"), "the spinner keeps going");
  assert.equal(vars().y, "52px");
  finish().resolve();
  await settle();
  assert.ok(!indicator()!.hasClass("ak-ptr-loading"));
  env.touch("touchcancel");
});

test("a cancelled touch hides the indicator without refreshing", () => {
  const { env, calls, indicator, pull } = setup();
  pull(90, { lift: false });
  env.touch("touchcancel");
  assert.deepEqual(calls, []);
  assert.ok(!indicator()!.hasClass("ak-ptr-pulling"));
});

test("overscroll-behavior-y is contain while bound and put back on destroy", () => {
  const env = loadKit(["ak-native.js"]);
  env.document.documentElement.style.overscrollBehaviorY = "auto";
  const handle = env.window.AppKit.pullToRefresh({ onRefresh: () => {}, threshold: THRESHOLD });
  assert.equal(env.document.documentElement.style.overscrollBehaviorY, "contain");
  handle.destroy();
  assert.equal(env.document.documentElement.style.overscrollBehaviorY, "auto");

  const bare = loadKit(["ak-native.js"]);
  const other = bare.window.AppKit.pullToRefresh({ onRefresh: () => {}, threshold: THRESHOLD });
  assert.equal(bare.document.documentElement.style.overscrollBehaviorY, "contain");
  other.destroy();
  assert.equal(bare.document.documentElement.style.overscrollBehaviorY, "");
});

test("destroy removes the indicator and the gesture, and can be called twice", () => {
  const { env, calls, handle, indicator, pull } = setup();
  pull(40, { lift: false });
  assert.ok(indicator());
  handle.destroy();
  assert.equal(indicator(), null, "the indicator is removed");
  pull(90);
  assert.deepEqual(calls, [], "touches no longer start a pull");
  assert.equal(indicator(), null);
  handle.destroy();
  assert.equal(env.document.documentElement.style.overscrollBehaviorY, "");
});

test("onRefresh is required", () => {
  const env = loadKit(["ak-native.js"]);
  assert.throws(() => env.window.AppKit.pullToRefresh({}), /onRefresh/);
});
