/**
 * Fixed-window counter per key, in memory. Expired windows are pruned so the map stays bounded.
 *
 * The clock is the `now` argument (milliseconds), so a test can pass its own time.
 * State is per process: it resets on restart and is not shared between instances.
 */
export type RateLimiter = {
  /** Counts one request. False once the key is over the limit for this window. */
  hit(key: string, now: number): boolean;
  /** Milliseconds until this key's current window ends. 0 when it has none. */
  resetIn(key: string, now: number): number;
  /** Number of keys currently held. Never more than `maxKeys`. */
  size(): number;
};

export type RateLimiterOptions = {
  /** Hits allowed per key in one window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Upper bound on tracked keys. Default 10_000. */
  maxKeys?: number;
};

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { limit, windowMs } = options;
  const maxKeys = options.maxKeys ?? 10_000;
  if (!Number.isFinite(limit) || limit < 0) throw new RangeError("limit must be a number >= 0");
  if (!Number.isFinite(windowMs) || windowMs <= 0) throw new RangeError("windowMs must be a number > 0");
  if (!Number.isInteger(maxKeys) || maxKeys < 1) throw new RangeError("maxKeys must be an integer >= 1");

  const windows = new Map<string, { start: number; count: number }>();
  let prunedAt = -Infinity;

  function prune(now: number): void {
    prunedAt = now;
    for (const [key, window] of windows) {
      if (now - window.start >= windowMs) windows.delete(key);
    }
  }

  function makeRoom(now: number): void {
    if (windows.size < maxKeys) return;
    prune(now);
    // Still full of live windows: drop the oldest. Map keeps insertion order.
    for (const key of windows.keys()) {
      if (windows.size < maxKeys) break;
      windows.delete(key);
    }
  }

  return {
    hit(key, now) {
      if (now - prunedAt >= windowMs) prune(now);
      let window = windows.get(key);
      if (!window || now - window.start >= windowMs) {
        windows.delete(key);
        makeRoom(now);
        window = { start: now, count: 0 };
        windows.set(key, window);
      }
      window.count += 1;
      return window.count <= limit;
    },
    resetIn(key, now) {
      const window = windows.get(key);
      return window ? Math.max(0, window.start + windowMs - now) : 0;
    },
    size: () => windows.size,
  };
}
