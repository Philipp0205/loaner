import type { BrowserContext } from "playwright-core";

type Entry = { id: string; date: string; title: string; bullets: string[] };

// public/changelog.js is plain JS with no DOM use, so node can load it directly.
const { CHANGELOG } = (await import(new URL("../../public/changelog.js", import.meta.url).href)) as { CHANGELOG: Entry[] };
const { SEEN_KEY } = (await import(new URL("../../public/whats-new.js", import.meta.url).href)) as { SEEN_KEY: string };

export const ENTRIES: Entry[] = CHANGELOG;
export const SEEN_STORAGE_KEY: string = SEEN_KEY;

/** Newest What's new id in the shipped changelog. */
export const LATEST_WHATS_NEW: string = CHANGELOG[0]?.id ?? "";

/**
 * Specs that sign in by stuffing a token into localStorage skip the sign-up path, so they start with
 * nothing seen and the What's new sheet would cover the screen they test. This marks the changelog as
 * read on every page of the context. Call it before the first page loads.
 */
export async function skipWhatsNew(context: BrowserContext): Promise<void> {
  await context.addInitScript(
    ([key, id]) => {
      if (id && !localStorage.getItem(key)) localStorage.setItem(key, id);
    },
    [SEEN_STORAGE_KEY, LATEST_WHATS_NEW] as const,
  );
}
