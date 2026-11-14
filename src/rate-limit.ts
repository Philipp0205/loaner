/** Fixed-window counter per key, in memory. Old windows are pruned so the map stays small. */
export type RateLimiter = {
  /** Counts one hit. False once the key is over the limit for this window. */
  hit(key: string, now: number): boolean;
};

export function createRateLimiter(options: { limit: number; windowMs: number; maxKeys?: number }): RateLimiter {
  const maxKeys = options.maxKeys ?? 5000;
  const windows = new Map<string, { start: number; count: number }>();
  return {
    hit(key, now) {
      let window = windows.get(key);
      if (!window || now - window.start >= options.windowMs) {
        if (windows.size >= maxKeys) {
          for (const [k, w] of windows) if (now - w.start >= options.windowMs) windows.delete(k);
          if (windows.size >= maxKeys) windows.delete(windows.keys().next().value as string);
        }
        window = { start: now, count: 0 };
        windows.set(key, window);
      }
      window.count += 1;
      return window.count <= options.limit;
    },
  };
}
