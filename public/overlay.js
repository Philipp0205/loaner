/**
 * Sheets with the phone's Back button wired in. A thin wrapper over AppKit.sheet.show: it counts the open
 * sheets and hands that count to AppKit.nav.syncOverlayHistory, so Back closes the top sheet instead of
 * leaving the installed app. Same options as the kit: { head, onClose, focus }.
 */
const open = [];

function sync() {
  window.AppKit.nav.syncOverlayHistory({
    depth: () => open.length,
    onPop: () => open[open.length - 1]?.close(),
  });
}

/** Returns { close } or null when a sheet is already open. */
export function showSheet(node, opts = {}) {
  const entry = { close: () => {} };
  const control = window.AppKit.sheet.show(node, {
    ...opts,
    onClose: () => {
      const at = open.indexOf(entry);
      if (at >= 0) open.splice(at, 1);
      opts.onClose?.();
      sync();
    },
  });
  if (!control) return null;
  entry.close = control.close;
  open.push(entry);
  sync();
  return control;
}
