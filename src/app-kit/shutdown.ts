import type http from "node:http";

/** The part of a node:http server the shutdown needs. */
export type ClosableServer = Pick<http.Server, "close" | "closeIdleConnections">;

export type GracefulShutdownOptions = {
  server: ClosableServer;
  /**
   * Runs once, after the server has closed (or the force timer fired), just before exit.
   * Close the database here. May be async. A throw is logged and does not stop the exit.
   */
  onClose?: () => void | Promise<void>;
  /** If close hangs on a keep-alive socket, exit after this many ms anyway. Default 8000. */
  forceExitMs?: number;
  /** Signals to listen for. Default SIGTERM and SIGINT. */
  signals?: readonly string[];
  /** Default process.exit. Called with 0 after a clean close or a forced stop. */
  exit?: (code: number) => void;
  /** Default console.log. */
  log?: (message: string) => void;
  /** Default console.error. */
  logError?: (message: string, error: unknown) => void;
  /** Default process.on and process.off. Inject both to test without touching the process. */
  on?: (signal: string, listener: () => void) => void;
  off?: (signal: string, listener: () => void) => void;
  /** Default setTimeout and clearTimeout. The default timer is unref'd. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
};

export type GracefulShutdown = {
  /** Starts the shutdown. A second call does nothing. */
  shutdown: (reason?: string) => void;
  /** Removes the signal listeners. A shutdown that has already started keeps going, force timer included. */
  dispose: () => void;
};

/**
 * Closes the server on SIGTERM or SIGINT, then runs onClose once and exits.
 * Modelled on loaner's src/server.ts: server.close(), closeIdleConnections() so keep-alive
 * sockets do not hold it open, and a force-exit timer (unref'd) for the ones that still do.
 * Every side effect is injectable, so tests never touch the real process.
 */
export function installGracefulShutdown(options: GracefulShutdownOptions): GracefulShutdown {
  const { server, onClose } = options;
  const forceExitMs = options.forceExitMs ?? 8000;
  const signals = options.signals ?? ["SIGTERM", "SIGINT"];
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const log = options.log ?? ((message: string) => console.log(message));
  const logError = options.logError ?? ((message: string, error: unknown) => console.error(message, error));
  const on = options.on ?? ((signal: string, listener: () => void) => void process.on(signal as NodeJS.Signals, listener));
  const off = options.off ?? ((signal: string, listener: () => void) => void process.off(signal as NodeJS.Signals, listener));
  const setTimer =
    options.setTimer ??
    ((fn: () => void, ms: number) => {
      const timer = setTimeout(fn, ms);
      timer.unref();
      return timer;
    });
  const clearTimer = options.clearTimer ?? ((timer: unknown) => clearTimeout(timer as NodeJS.Timeout));

  let started = false;
  let finished = false;
  let closeStarted = false;
  let timer: unknown;
  const listeners = new Map<string, () => void>();

  async function finish(): Promise<void> {
    if (finished) return;
    finished = true;
    if (timer !== undefined) clearTimer(timer);
    try {
      await onClose?.();
    } catch (error) {
      logError("shutdown: onClose failed", error instanceof Error ? error.message : error);
    }
    exit(0);
  }

  function shutdown(reason = "shutdown"): void {
    if (started) return;
    started = true;
    log(`stopping on ${reason}`);
    timer = setTimer(() => void finish(), forceExitMs);
    if (!closeStarted) {
      closeStarted = true;
      server.close(() => void finish());
    }
    server.closeIdleConnections();
  }

  for (const signal of signals) {
    const listener = () => shutdown(signal);
    listeners.set(signal, listener);
    on(signal, listener);
  }

  function dispose(): void {
    for (const [signal, listener] of listeners) off(signal, listener);
    listeners.clear();
  }

  return { shutdown, dispose };
}
