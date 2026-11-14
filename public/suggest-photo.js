import { PROMPT_LABELS, pickBest } from "./suggest-labels.js";

// A pinned browser build of Transformers.js. It is loaded only when a photo is first looked at,
// and it fetches the CLIP weights (Xenova/clip-vit-base-patch32) into the browser cache.
const LIB_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js";
const MODEL = "Xenova/clip-vit-base-patch32";

let loading = null;

/** Loads the zero-shot classifier once. Resolves to async (blob) => [{ label, score }]. A failed load can be retried. */
function loadClassifier() {
  if (!loading) {
    loading = (async () => {
      const lib = await import(LIB_URL);
      lib.env.allowLocalModels = false;
      lib.env.backends.onnx.wasm.numThreads = 1;
      lib.env.backends.onnx.wasm.proxy = false;
      const classify = await lib.pipeline("zero-shot-image-classification", MODEL);
      return async (blob) => classify(await lib.RawImage.fromBlob(blob), PROMPT_LABELS, { hypothesis_template: "a photo of a {}." });
    })();
    loading.catch(() => { loading = null; });
  }
  return loading;
}

/**
 * Suggests a name and category for a photo, on this device. Returns { name, category, score } or null
 * when the model is unsure, cannot load, or fails. `load` is only swapped out by unit tests.
 */
export async function suggestFromPhoto(blob, load = loadClassifier) {
  try {
    if (typeof globalThis.__loanerSuggestFromPhoto === "function") return (await globalThis.__loanerSuggestFromPhoto(blob)) ?? null;
    const classify = await load();
    return pickBest(await classify(blob));
  } catch {
    return null;
  }
}
