// Load this with `node --import tsx --import ./src/quiet-warnings.ts src/server.ts`, not as an
// import inside the app. ESM links builtins like node:sqlite while the module graph is being
// instantiated, before any module body runs, so only a preload installs the filter in time.
// It drops only the node:sqlite ExperimentalWarning, which Railway shows at error level.
// Every other warning still goes through.
const emitWarning = process.emitWarning.bind(process);

function isSqliteExperimental(warning: unknown, args: unknown[]): boolean {
  const message = typeof warning === "string" ? warning : warning instanceof Error ? warning.message : "";
  const first = args[0];
  const type =
    typeof first === "string" ? first
    : first && typeof first === "object" && "type" in first ? String((first as { type: unknown }).type)
    : warning instanceof Error ? warning.name
    : "";
  return type === "ExperimentalWarning" && /sqlite/i.test(message);
}

process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
  if (isSqliteExperimental(warning, args)) return;
  (emitWarning as (...all: unknown[]) => void)(warning, ...args);
}) as typeof process.emitWarning;
