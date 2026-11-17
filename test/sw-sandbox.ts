import fs from "node:fs";
import vm from "node:vm";

export const ORIGIN = "https://app.example";

const read = (path: string) => fs.readFileSync(new URL(`../public${path}`, import.meta.url), "utf8");

export type Handler = (event: any) => unknown;

/**
 * Runs the real public/sw.js in a vm sandbox. importScripts runs the real kit worker from public/app-kit, so
 * the kit's own install, activate, fetch and message handlers register too. Handlers are kept in the order
 * they were added, per event type.
 */
export function loadWorker(overrides: Record<string, unknown> = {}) {
  const handlers: Record<string, Handler[]> = {};
  const imported: string[] = [];
  const log: string[] = [];
  const added: string[][] = [];
  const sandbox: Record<string, any> = {
    URL,
    Request: class { constructor(public url: string, public init?: unknown) {} },
    Promise,
    location: { origin: ORIGIN },
    addEventListener: (type: string, handler: Handler) => { (handlers[type] ||= []).push(handler); },
    clients: {
      matchAll: async () => [],
      openWindow: async () => null,
      claim: () => { log.push("claim"); },
    },
    caches: {
      open: async () => ({ addAll: async (requests: { url: string }[]) => { added.push(requests.map((r) => r.url)); } }),
      keys: async () => [],
      delete: async () => true,
    },
    skipWaiting: () => { log.push("skipWaiting"); },
    ...overrides,
  };
  sandbox.self = sandbox;
  let setupOptions: Record<string, any> | null = null;
  sandbox.importScripts = (path: string) => {
    imported.push(path);
    vm.runInContext(read(path), sandbox);
    const real = sandbox.AppKitSW.setup;
    sandbox.AppKitSW.setup = (options: Record<string, any>) => {
      setupOptions = options;
      return real(options);
    };
  };
  vm.createContext(sandbox);
  vm.runInContext(read("/sw.js"), sandbox);
  return { sandbox, handlers, imported, log, added, setupOptions: () => setupOptions };
}
