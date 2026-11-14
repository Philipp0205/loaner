import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type { Page } from "playwright-core";
import { useLoaner } from "./harness.js";
import { solidPng } from "./png.js";

const SHOTS = path.resolve("test/ui/screenshots/camera-add");
// Fake-camera flags stay local to this spec, so no other spec's browser changes.
const loaner = useLoaner({}, ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"]);

const shot = async (page: Page, name: string) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name) });
};

/** Signs up through the UI (which also marks What's new as seen), creates a group, and opens My items. */
async function startOnMyItems(page: Page) {
  await page.goto(loaner.baseUrl);
  await page.locator("#name").fill("Cam");
  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByRole("heading", { name: "No groups yet" }).waitFor();
  await page.locator("#group-name").fill("Flat 3B");
  await page.getByRole("button", { name: "Create group" }).click();
  await page.locator(".tabbar").getByRole("button", { name: "My items" }).click();
  await page.getByRole("heading", { level: 1, name: "My items" }).waitFor();
}

const streamsLive = (page: Page) =>
  page.evaluate(() => {
    const video = document.querySelector<HTMLVideoElement>("#camera-video");
    const stream = video?.srcObject as MediaStream | null | undefined;
    return !!stream && stream.getTracks().some((t) => t.readyState === "live");
  });

test("Add an item opens the camera, Type it in gives an empty form, a gallery photo prefills it", { timeout: 120_000 }, async () => {
  const ctx = await loaner.phone();
  await ctx.grantPermissions(["camera"], { origin: loaner.baseUrl });
  // The stand-in for the on-device model: tests never download CLIP.
  await ctx.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__loanerSuggestFromPhoto = async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      return { name: "Cordless drill", category: "Tools" };
    };
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const external: string[] = [];
  page.on("request", (request) => { if (!request.url().startsWith(loaner.baseUrl) && !/^(blob|data):/.test(request.url())) external.push(request.url()); });
  await startOnMyItems(page);

  // 1. The camera covers the tab bar and shows a live rear-camera view.
  await page.getByRole("button", { name: "Add an item" }).click();
  await page.locator("#camera-add").waitFor();
  assert.equal(new URL(page.url()).hash, "#/mine/new");
  await page.waitForFunction(() => (document.querySelector("#camera-video") as HTMLVideoElement | null)?.videoWidth! > 0);
  assert.equal(await streamsLive(page), true);
  const layout = await page.evaluate(() => {
    const cam = document.querySelector("#camera-add")!.getBoundingClientRect();
    const camZ = Number(getComputedStyle(document.querySelector("#camera-add")!).zIndex);
    const tabZ = Number(getComputedStyle(document.querySelector(".tabbar")!).zIndex);
    const top = document.elementFromPoint(195, 800)?.closest("#camera-add") !== null;
    const heights = ["#camera-shutter", "#camera-gallery", "#camera-type"].map((sel) => document.querySelector(sel)!.getBoundingClientRect().height);
    return { w: cam.width, h: cam.height, camZ, tabZ, top, shutter: heights[0], gallery: heights[1], type: heights[2] };
  });
  assert.deepEqual([layout.w, layout.h], [390, 844], "full screen");
  assert.ok(layout.camZ > layout.tabZ, "above the tab bar");
  assert.equal(layout.top, true, "the camera, not the tab bar, is at the bottom of the screen");
  assert.ok(layout.shutter >= 64 && layout.type >= 44, "large tap targets");
  assert.equal(await page.locator("#camera-fallback").isVisible(), false);
  await page.getByText("From gallery").waitFor();
  await shot(page, "01-camera.png");

  // 2. Type it in: the empty form. The camera stops.
  await page.locator("#camera-type").click();
  await page.locator("#item-name").waitFor();
  assert.equal(new URL(page.url()).hash, "#/mine/new/form");
  assert.equal(await page.locator("#item-name").inputValue(), "");
  assert.equal(await page.locator("#item-category").inputValue(), "");
  assert.equal(await page.locator("img.preview").count(), 0);
  assert.equal(await page.locator("#camera-add").count(), 0);
  await page.locator("#item-photo").setInputFiles({ name: "a.png", mimeType: "image/png", buffer: solidPng(40, 30, [10, 120, 90]) });
  await page.locator("img.preview").waitFor();
  await shot(page, "02-form-typed.png");

  // Cancel returns to My items. Going back in gives a fresh camera with no leftover draft.
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("heading", { level: 1, name: "My items" }).waitFor();
  await page.getByRole("button", { name: "Add an item" }).click();
  await page.locator("#camera-add").waitFor();

  // 3. A gallery photo: "Looking at the photo...", then the form with the suggestion.
  await page.locator("#camera-gallery").setInputFiles({ name: "drill.png", mimeType: "image/png", buffer: solidPng(800, 600, [200, 90, 40]) });
  await page.locator("#camera-status", { hasText: "Looking at the photo..." }).waitFor();
  assert.equal(await page.locator("#camera-shutter").isDisabled(), true, "shutter is off while suggesting");
  assert.equal(await page.locator("#camera-gallery").isDisabled(), true, "gallery is off while suggesting");
  await shot(page, "03-looking.png");
  await page.locator("#item-name").waitFor();
  assert.equal(new URL(page.url()).hash, "#/mine/new/form");
  assert.equal(await page.locator("#item-name").inputValue(), "Cordless drill");
  assert.equal(await page.locator("#item-category").inputValue(), "Tools");
  await page.locator("img.preview").waitFor();
  assert.equal(await page.locator("img.preview").evaluate((img: HTMLImageElement) => img.naturalWidth), 800);
  await shot(page, "04-form-suggested.png");

  // 4. Both fields stay editable, and the item saves with the edited values.
  await page.locator("#item-name").fill("Drill driver");
  await page.locator("#item-category").selectOption("Household");
  await page.getByRole("button", { name: "Add item" }).click();
  await page.getByRole("heading", { level: 1, name: "Drill driver" }).waitFor();
  await page.locator("[data-category]", { hasText: "Household" }).waitFor();
  await page.locator("img.photo.big").waitFor();
  await page.waitForFunction(() => (document.querySelector("img.photo.big") as HTMLImageElement | null)?.naturalWidth === 800);

  // The owner's card shows the category quietly. Then a new camera view has no leftover draft.
  await page.locator(".tabbar").getByRole("button", { name: "My items" }).click();
  await page.locator("article.card", { hasText: "Drill driver" }).locator("[data-category]", { hasText: "Household" }).waitFor();
  await page.getByRole("button", { name: "Add an item" }).click();
  await page.locator("#camera-type").click();
  assert.equal(await page.locator("#item-name").inputValue(), "", "the draft was cleared after the add");
  assert.equal(await page.locator("#item-category").inputValue(), "");
  assert.equal(await page.locator("img.preview").count(), 0);

  // Edit keeps working and also has the category field.
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.locator("article.card", { hasText: "Drill driver" }).getByRole("button", { name: "Edit" }).click();
  assert.equal(await page.locator("#item-category").inputValue(), "Household");

  assert.deepEqual(errors, []);
  assert.deepEqual(external, [], "nothing leaves the app in this test, no model download");
  await ctx.close();
});

test("a failed or unsure suggestion keeps the photo and leaves the name empty", { timeout: 90_000 }, async () => {
  const ctx = await loaner.phone();
  await ctx.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__loanerSuggestFromPhoto = async () => null;
  });
  const page = await ctx.newPage();
  await startOnMyItems(page);
  await page.getByRole("button", { name: "Add an item" }).click();
  await page.locator("#camera-add").waitFor();
  await page.locator("#camera-gallery").setInputFiles({ name: "thing.png", mimeType: "image/png", buffer: solidPng(300, 200, [30, 30, 200]) });
  await page.locator("#item-name").waitFor();
  assert.equal(await page.locator("#item-name").inputValue(), "");
  assert.equal(await page.locator("#item-category").inputValue(), "");
  await page.locator("img.preview").waitFor();
  await ctx.close();
});

test("the shutter takes a frame from the live camera and opens the form with it", { timeout: 90_000 }, async () => {
  const ctx = await loaner.phone();
  await ctx.grantPermissions(["camera"], { origin: loaner.baseUrl });
  await ctx.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__loanerSuggestFromPhoto = async () => ({ name: "Tent", category: "Camping" });
  });
  const page = await ctx.newPage();
  await startOnMyItems(page);
  await page.getByRole("button", { name: "Add an item" }).click();
  await page.waitForFunction(() => (document.querySelector("#camera-video") as HTMLVideoElement | null)?.videoWidth! > 0);
  await page.locator("#camera-shutter").click();
  await page.locator("#item-name").waitFor();
  assert.equal(await page.locator("#item-name").inputValue(), "Tent");
  assert.equal(await page.locator("#item-category").inputValue(), "Camping");
  await page.locator("img.preview").waitFor();
  await ctx.close();
});

test("the camera stops when you leave the view", { timeout: 90_000 }, async () => {
  const ctx = await loaner.phone();
  await ctx.grantPermissions(["camera"], { origin: loaner.baseUrl });
  // Counts tracks still live, across every stream the page opened.
  await ctx.addInitScript(() => {
    const w = window as unknown as { __streams: MediaStream[] };
    w.__streams = [];
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await real(constraints);
      w.__streams.push(stream);
      return stream;
    };
  });
  const page = await ctx.newPage();
  await startOnMyItems(page);
  const live = () => page.evaluate(() => (window as unknown as { __streams: MediaStream[] }).__streams.flatMap((s) => s.getTracks()).filter((t) => t.readyState === "live").length);

  await page.getByRole("button", { name: "Add an item" }).click();
  await page.waitForFunction(() => (document.querySelector("#camera-video") as HTMLVideoElement | null)?.videoWidth! > 0);
  assert.ok((await live()) > 0, "camera is on");
  await page.locator("#camera-close").click();
  await page.getByRole("heading", { level: 1, name: "My items" }).waitFor();
  assert.equal(new URL(page.url()).hash, "#/mine");
  assert.equal(await live(), 0, "closing stops the camera");

  await page.getByRole("button", { name: "Add an item" }).click();
  await page.waitForFunction(() => (document.querySelector("#camera-video") as HTMLVideoElement | null)?.videoWidth! > 0);
  assert.ok((await live()) > 0);
  await page.locator("#camera-type").click();
  await page.locator("#item-name").waitFor();
  assert.equal(await live(), 0, "Type it in stops the camera");
  await ctx.close();
});

test("with the camera denied, the view stays put with a message, gallery and Type it in", { timeout: 90_000 }, async () => {
  const ctx = await loaner.phone();
  // Chrome's fake-UI flag auto-accepts permission, so a denial is simulated by making getUserMedia reject
  // the way a real denial does (NotAllowedError). A device with no camera at all is covered further down.
  await ctx.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
    (window as unknown as Record<string, unknown>).__loanerSuggestFromPhoto = async () => ({ name: "Hammer", category: "Tools" });
  });
  const page = await ctx.newPage();
  await startOnMyItems(page);
  await page.getByRole("button", { name: "Add an item" }).click();
  await page.locator("#camera-fallback").waitFor();
  assert.equal(new URL(page.url()).hash, "#/mine/new", "no automatic bounce to the form");
  assert.match(await page.locator("#camera-fallback").innerText(), /permission/i);
  assert.equal(await page.locator("#camera-video").isVisible(), false);
  assert.equal(await page.locator("#camera-shutter").isVisible(), false);
  assert.equal(await page.locator("#camera-type").isVisible(), true);
  await page.getByText("From gallery").waitFor();
  await shot(page, "05-camera-denied.png");

  await page.locator("#camera-gallery").setInputFiles({ name: "h.png", mimeType: "image/png", buffer: solidPng(120, 90, [90, 90, 90]) });
  await page.locator("#item-name").waitFor();
  assert.equal(await page.locator("#item-name").inputValue(), "Hammer");
  await ctx.close();
});

test("with no camera at all, the view shows the no-camera message and Type it in works", { timeout: 90_000 }, async () => {
  const ctx = await loaner.phone();
  await ctx.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("Requested device not found", "NotFoundError"));
  });
  const page = await ctx.newPage();
  await startOnMyItems(page);
  await page.getByRole("button", { name: "Add an item" }).click();
  await page.locator("#camera-fallback").waitFor();
  assert.match(await page.locator("#camera-fallback").innerText(), /no camera/i);
  assert.equal(await page.locator("#camera-shutter").isVisible(), false);
  await page.locator("#camera-type").click();
  await page.locator("#item-name").waitFor();
  assert.equal(await page.locator("#item-name").inputValue(), "");
  await ctx.close();
});
