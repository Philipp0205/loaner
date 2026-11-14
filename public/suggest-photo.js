import { PROMPT_LABELS, pickBest } from "./suggest-labels.js";

// A pinned browser build of Transformers.js. It is loaded only when a photo is first looked at,
// and it fetches the CLIP weights (Xenova/clip-vit-base-patch32) into the browser cache.
const LIB_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js";
const MODEL = "Xenova/clip-vit-base-patch32";

/** How long the camera waits for a suggestion before it opens the form without one. */
export const SUGGEST_TIMEOUT_MS = 15000;

let loading = null;
let report = () => {};
const files = new Map();

const mb = (bytes) => Math.round(bytes / 1048576);

/** "Downloading the on-device model... 12 of 147 MB" from a Map of file -> { loaded, total }. */
export function progressText(sizes) {
  let loaded = 0;
  let total = 0;
  for (const size of sizes.values()) {
    loaded += size.loaded;
    total += size.total;
  }
  return total ? `Downloading the on-device model... ${mb(loaded)} of ${mb(total)} MB` : "Downloading the on-device model...";
}

/** Transformers.js progress events. Only big files are reported, so cached or tiny files add no flicker. */
function onModelEvent(event) {
  if (event.status === "progress" && event.total >= 1048576) {
    files.set(event.file, { loaded: event.loaded, total: event.total });
    report(progressText(files));
  } else if (event.status === "ready") {
    report(null);
  }
}

/** Loads the zero-shot classifier once. Resolves to async (blob) => [{ label, score }]. A failed load can be retried. */
function loadClassifier() {
  if (!loading) {
    loading = (async () => {
      const lib = await import(LIB_URL);
      lib.env.allowLocalModels = false;
      lib.env.backends.onnx.wasm.numThreads = 1;
      // Run ONNX in a worker so the page, its timer and Type it in stay responsive.
      lib.env.backends.onnx.wasm.proxy = true;
      const classify = await lib.pipeline("zero-shot-image-classification", MODEL, { progress_callback: onModelEvent });
      return async (blob) => classify(await lib.RawImage.fromBlob(blob), PROMPT_LABELS, { hypothesis_template: "a photo of a {}." });
    })();
    loading.catch(() => { loading = null; });
  }
  return loading;
}

/**
 * Suggests a name and category for a photo, on this device. Never rejects: it returns { name, category, score }
 * or null when the model is unsure, cannot load, or fails. `onProgress(text)` hears about a model download
 * (and `null` when it is done). `load` is only swapped out by unit tests.
 */
export async function suggestFromPhoto(blob, load = loadClassifier, onProgress) {
  report = onProgress || (() => {});
  try {
    if (typeof globalThis.__loanerSuggestFromPhoto === "function") return (await globalThis.__loanerSuggestFromPhoto(blob, report)) ?? null;
    const classify = await load();
    return pickBest(await classify(blob));
  } catch {
    return null;
  }
}

/** Waits for `work` (a promise that never rejects) for at most `ms`. Resolves { done: true, guess } or { done: false }. */
export function raceTimeout(work, ms) {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve({ done: false }), ms); });
  const settled = work.then((guess) => ({ done: true, guess }), () => ({ done: true, guess: null }));
  return Promise.race([settled, late]).finally(() => clearTimeout(timer));
}
