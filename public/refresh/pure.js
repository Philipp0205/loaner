// Screens that hold work a redraw would throw away: the camera and the add and edit item forms.
const KEEP_AS_IS = [/^#\/mine\/new(\/|$)/, /^#\/mine\/edit\//];

/** True when a pull may redraw the screen at `hash`. Elsewhere a pull only refreshes the shared state. */
export const redrawable = (hash) => !KEEP_AS_IS.some((pattern) => pattern.test(hash));

/** True when a touch started inside something modal (an open sheet, the photo viewer), where a pull must not start. */
export function inModal(target, root = document.documentElement) {
  return root.classList.contains("ak-sheet-open") || !!target?.closest?.(".pv");
}
