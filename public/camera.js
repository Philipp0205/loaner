import { downscale } from "./photo.js";
import { clearDraft, setDraft } from "./draft.js";
import { go, stayedPut } from "./state.js";
import { suggestFromPhoto } from "./suggest-photo.js";
import { h } from "./util.js";

const FORM = "#/mine/new/form";
let stream = null;
let generation = 0;

/** Stops the camera. Safe to call any time; app.js calls it whenever the route changes. */
export function stopCamera() {
  generation += 1;
  if (stream) for (const track of stream.getTracks()) track.stop();
  stream = null;
}

function fallbackText(error) {
  const name = error && error.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "We need permission to use the camera. Allow it in your browser settings, or pick a photo instead.";
  return "No camera found on this device. Pick a photo instead, or type it in.";
}

/** The full-screen camera view for #/mine/new. */
export function renderCamera() {
  stopCamera();
  clearDraft();
  const video = h("video", { id: "camera-video", autoplay: true, playsinline: true, muted: true });
  video.muted = true;
  const status = h("p", { id: "camera-status", class: "cam-status", role: "status" });
  const fallback = h("p", { id: "camera-fallback", class: "cam-fallback hidden" });
  const shutter = h("button", { id: "camera-shutter", class: "cam-shutter", type: "button", "aria-label": "Take photo" });
  const pick = h("input", { id: "camera-gallery", type: "file", accept: "image/*", class: "sr-only" });
  const gallery = h("label", { class: "cam-btn" }, "From gallery", pick);
  const type = h("button", { id: "camera-type", class: "cam-btn", type: "button", onclick: () => { stopCamera(); go(FORM); } }, "Type it in");
  const close = h("button", { id: "camera-close", class: "cam-close", type: "button", "aria-label": "Close", onclick: () => { stopCamera(); go("#/mine"); } }, "\u00d7");

  const lock = (on) => {
    shutter.disabled = on;
    pick.disabled = on;
    gallery.classList.toggle("disabled", on);
  };

  /** Shrinks the photo, asks the on-device model for a name, then opens the form with whatever came back. */
  async function useBlob(source) {
    const samePlace = stayedPut();
    lock(true);
    status.textContent = "Looking at the photo...";
    try {
      const blob = await downscale(source);
      const guess = await suggestFromPhoto(blob);
      if (!samePlace()) return;
      setDraft({ blob, name: guess ? guess.name : "", category: guess ? guess.category : "" });
      stopCamera();
      go(FORM);
    } catch (e) {
      status.textContent = e.message || "Could not use that photo.";
      lock(false);
    }
  }

  shutter.addEventListener("click", () => {
    if (!video.videoWidth) {
      status.textContent = "The camera is still starting. Try again in a moment.";
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    canvas.toBlob((blob) => (blob ? useBlob(blob) : (status.textContent = "Could not take the photo. Try again.")), "image/jpeg", 0.92);
  });

  pick.addEventListener("change", () => {
    const file = pick.files[0];
    pick.value = "";
    if (file) useBlob(file);
  });

  const showFallback = (error) => {
    video.classList.add("hidden");
    shutter.classList.add("hidden");
    fallback.textContent = fallbackText(error);
    fallback.classList.remove("hidden");
  };

  const media = navigator.mediaDevices;
  if (!media || typeof media.getUserMedia !== "function") {
    showFallback(null);
  } else {
    const mine = generation;
    media
      .getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
      .then((s) => {
        if (mine !== generation) {
          for (const track of s.getTracks()) track.stop();
          return;
        }
        stream = s;
        video.srcObject = s;
        video.play().catch(() => {});
      })
      .catch((error) => {
        if (mine === generation) showFallback(error);
      });
  }

  return h("section", { id: "camera-add", class: "camera", "aria-label": "Add an item" },
    video,
    fallback,
    close,
    h("div", { class: "cam-bottom" },
      status,
      h("div", { class: "cam-controls" }, gallery, shutter, type),
    ),
  );
}
