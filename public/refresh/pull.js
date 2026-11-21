import { inModal, redrawable } from "./pure.js";

/**
 * Pull to refresh for the signed-in app. The gesture, the resistance and the spinner all come from the kit's
 * AppKit.pullToRefresh, bound to the page. This only decides what a refresh does:
 *   refreshAll()     reload the shared state and redraw the current screen
 *   refreshShared()  reload the shared state only (badge, groups), used when a redraw would lose work
 * A redraw is skipped on the camera and item forms, and after the person typed on this screen.
 * `onError` runs when a refresh fails. bind() is safe to call again, unbind() on leaving the main app.
 */
export function createPullRefresh({ refreshAll, refreshShared, hash, onError }) {
  let handle = null;
  let typed = false;

  const run = async () => {
    try {
      await (redrawable(hash()) && !typed ? refreshAll() : refreshShared());
    } catch {
      onError();
    }
  };
  const onInput = () => { typed = true; };
  // Runs first (capture) and keeps the touch from the kit while a sheet or the photo viewer is open.
  const shield = (event) => { if (inModal(event.target)) event.stopPropagation(); };

  return {
    bind() {
      if (handle) return;
      document.addEventListener("touchstart", shield, { capture: true, passive: true });
      document.addEventListener("input", onInput, true);
      handle = window.AppKit.pullToRefresh({ onRefresh: run, threshold: 70 });
    },
    unbind() {
      if (!handle) return;
      handle.destroy();
      handle = null;
      document.removeEventListener("touchstart", shield, true);
      document.removeEventListener("input", onInput, true);
    },
    /** Call when a new screen is on show: nothing typed on it yet. */
    screenShown() {
      typed = false;
    },
  };
}
