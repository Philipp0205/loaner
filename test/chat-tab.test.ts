import assert from "node:assert/strict";
import test from "node:test";

// The tab and bell wiring is plain JS with no DOM at import time, so node loads it directly.
const load = async <T>(path: string) => (await import(new URL(`../public/${path}`, import.meta.url).href)) as T;
const { TABS, tabBadges } = await load<{ TABS: string[][]; tabBadges: (n: number) => Record<string, number> }>("nav/tabs.js");
const { totalUnread, previewLine, chatSignature, chatHash } = await load<any>("chat/pure.js");
const { closeTarget } = await load<{ closeTarget: (r: string | null, n: number) => { back: boolean; hash?: string } }>("alerts/return.js");
const { bellLabel, ALERTS_COPY } = await load<any>("alerts/copy.js");
const { CHAT_COPY } = await load<any>("chat/copy.js");

test("tabs: Browse, My items, Requests, Chat, You, with no Alerts tab", () => {
  assert.deepEqual(TABS.map(([id]) => id), ["browse", "mine", "requests", "chat", "you"]);
  assert.deepEqual(TABS.map(([, label]) => label), ["Browse", "My items", "Requests", "Chat", "You"]);
});

test("badges: the bar carries the Chat count only, never alerts", () => {
  assert.deepEqual(tabBadges(3), { chat: 3 });
  assert.deepEqual(tabBadges(0), { chat: 0 });
  assert.deepEqual(tabBadges(-2), { chat: 0 });
  assert.ok(!("alerts" in tabBadges(5)));
});

test("badges: the Chat total is the sum of unreadChat, and tolerates missing data", () => {
  assert.equal(totalUnread([{ unreadChat: 2 }, { unreadChat: 3 }, { unreadChat: 0 }]), 5);
  assert.equal(totalUnread([{ id: "g" }]), 0);
  assert.equal(totalUnread(undefined), 0);
});

test("rows: the preview names the author, says You for my own, and has a short empty line", () => {
  assert.equal(previewLine({ userId: "u2", author: "Bo", text: "hi" }, "u1"), "Bo: hi");
  assert.equal(previewLine({ userId: "u1", author: "Me", text: "hi" }, "u1"), `${CHAT_COPY.you}: hi`);
  assert.equal(previewLine(null, "u1"), CHAT_COPY.listEmpty);
  assert.equal(chatHash("g1"), "#/group/g1/chat");
});

test("rows: the signature changes when a message, a count or a name does", () => {
  const base = [{ id: "g", name: "Flat", unreadChat: 0, last: { at: 1 } }];
  assert.equal(chatSignature(base), chatSignature(structuredClone(base)));
  assert.notEqual(chatSignature(base), chatSignature([{ ...base[0], unreadChat: 1 }]));
  assert.notEqual(chatSignature(base), chatSignature([{ ...base[0], last: { at: 2 } }]));
  assert.notEqual(chatSignature(base), chatSignature([{ ...base[0], name: "Home" }]));
});

test("alerts Back: step back in history when the bell pushed it, else go to the tab or Browse", () => {
  assert.deepEqual(closeTarget("#/requests", 3), { back: true });
  assert.deepEqual(closeTarget("#/requests", 1), { back: false, hash: "#/requests" });
  assert.deepEqual(closeTarget(null, 4), { back: false, hash: "#/browse" });
});

test("bell: the label carries the unread count, and the copy has no em dash", () => {
  assert.equal(bellLabel(0), "Alerts");
  assert.equal(bellLabel(4), "Alerts, 4 unread");
  for (const text of [...Object.values(ALERTS_COPY), ...Object.values(CHAT_COPY)] as string[]) assert.ok(!text.includes("\u2014"), text);
});
