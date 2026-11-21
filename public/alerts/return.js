/** The screen the bell was tapped on, so Back from Alerts returns there. Only the bell sets it. */
let alertsReturn = null;

/** Where Back from Alerts goes: one step back in history when the bell pushed Alerts there, else a tab root. */
export function closeTarget(returnHash, historyLength) {
  if (returnHash && historyLength > 1) return { back: true };
  return { back: false, hash: returnHash || "#/browse" };
}

/** Remembers the screen the bell was tapped on. */
export function rememberReturn(hash) {
  alertsReturn = hash;
}

/** Back from Alerts. `go` is the app's hash navigation. The remembered screen is used once. */
export function closeAlerts(go) {
  const target = closeTarget(alertsReturn, window.history.length);
  alertsReturn = null;
  if (target.back) window.history.back();
  else go(target.hash);
}
