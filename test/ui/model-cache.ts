import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { BrowserContext } from "playwright-core";

/** Where downloaded model files are kept between runs. Gitignored. */
export const MODEL_CACHE = path.resolve("test/.model-cache");

const HOSTS = /^https:\/\/(cdn\.jsdelivr\.net|[^/]*\.cdn\.hf\.co|[^/]*\.xethub\.hf\.co)\//;

/** One file per URL without its query, because signed CDN links change on every request. */
const entry = (url: string) => {
  const u = new URL(url);
  return path.join(MODEL_CACHE, crypto.createHash("sha1").update(u.host + u.pathname).digest("hex"));
};

/**
 * Serves the big third-party files (the Transformers.js build and the CLIP weights) from disk when they
 * were fetched on an earlier run, and saves them on the first run. The huggingface.co redirect itself is
 * not touched, so the browser still follows it to the CDN host under the app's real CSP. If the network is
 * unreachable and nothing is cached, those requests fail, which is what the fallback path is for.
 * `pending` settles when every download that was started has finished.
 */
export async function cacheModelFiles(context: BrowserContext) {
  const inflight = new Set<Promise<unknown>>();
  const stats = { hits: 0, misses: 0, failures: 0 };
  await context.route(HOSTS, async (route) => {
    const file = entry(route.request().url());
    if (fs.existsSync(`${file}.json`)) {
      stats.hits += 1;
      const { status, headers } = JSON.parse(fs.readFileSync(`${file}.json`, "utf8"));
      await route.fulfill({ status, headers, body: fs.readFileSync(file) });
      return;
    }
    stats.misses += 1;
    const job = (async () => {
      try {
        const response = await route.fetch({ timeout: 0 });
        const body = await response.body();
        if (response.status() === 200) {
          fs.mkdirSync(MODEL_CACHE, { recursive: true });
          fs.writeFileSync(file, body);
          const type = response.headers()["content-type"] ?? "application/octet-stream";
          fs.writeFileSync(`${file}.json`, JSON.stringify({ status: 200, headers: { "content-type": type, "access-control-allow-origin": "*" } }));
        }
        await route.fulfill({ response, body });
      } catch {
        stats.failures += 1;
        await route.abort().catch(() => {});
      }
    })();
    inflight.add(job);
    job.finally(() => inflight.delete(job));
  });
  return {
    stats,
    /** Lets a cold run finish saving what it started, so the next run is fast. */
    async pending(ms: number) {
      if (!inflight.size) return;
      let timer: NodeJS.Timeout | undefined;
      const limit = new Promise((resolve) => { timer = setTimeout(resolve, ms); });
      await Promise.race([Promise.allSettled([...inflight]), limit]);
      clearTimeout(timer);
    },
  };
}
