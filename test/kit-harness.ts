import fs from "node:fs";
import vm from "node:vm";

/** A tiny DOM, just enough for the app-kit scripts (install prompt, theme colour). Not a general DOM. */

type Listener = (event: any) => void;

export class FakeNode {
  nodeType = 1;
  tagName: string;
  id = "";
  className = "";
  parentNode: FakeNode | null = null;
  children: FakeNode[] = [];
  attrs = new Map<string, string>();
  listeners = new Map<string, Listener[]>();
  text = "";
  innerHTML = "";
  disabled = false;
  style: Record<string, string> = {};

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }

  get firstChild(): FakeNode | null {
    return this.children[0] ?? null;
  }
  appendChild(node: FakeNode) {
    node.parentNode?.removeChild(node);
    node.parentNode = this;
    this.children.push(node);
    return node;
  }
  insertBefore(node: FakeNode, before: FakeNode | null) {
    node.parentNode?.removeChild(node);
    node.parentNode = this;
    const at = before ? this.children.indexOf(before) : -1;
    if (at < 0) this.children.push(node);
    else this.children.splice(at, 0, node);
    return node;
  }
  removeChild(node: FakeNode) {
    const at = this.children.indexOf(node);
    if (at >= 0) this.children.splice(at, 1);
    node.parentNode = null;
    return node;
  }
  setAttribute(name: string, value: string) {
    this.attrs.set(name, String(value));
    if (name === "id") this.id = String(value);
  }
  getAttribute(name: string) {
    return this.attrs.has(name) ? (this.attrs.get(name) as string) : null;
  }
  hasAttribute(name: string) {
    return this.attrs.has(name);
  }
  removeAttribute(name: string) {
    this.attrs.delete(name);
  }
  addEventListener(type: string, fn: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener(type: string, fn: Listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== fn));
  }
  /** Calls the listeners of `type` with an event. Returns the event. */
  dispatch(type: string, event: Record<string, unknown> = {}) {
    const full = { type, cancelable: true, defaultPrevented: false, preventDefault() { full.defaultPrevented = true; }, ...event };
    for (const fn of this.listeners.get(type) ?? []) fn(full);
    return full;
  }
  /** What the scroller reports. Only the page scroller uses it. */
  scrollTop = 0;
  click() {
    for (const fn of this.listeners.get("click") ?? []) fn({ type: "click" });
  }
  select() {}
  /** All text under this node. */
  get textContent(): string {
    return this.nodeType === 3 ? this.text : this.children.map((c) => c.textContent).join("");
  }
  set textContent(value: string) {
    this.children = [];
    this.appendChild(textNode(String(value)));
  }
  walk(): FakeNode[] {
    return this.children.flatMap((c) => [c, ...c.walk()]);
  }
  hasClass(name: string) {
    return this.className.split(/\s+/).includes(name);
  }
}

export function find(root: FakeNode, test: (node: FakeNode) => boolean): FakeNode | null {
  return root.walk().find(test) ?? null;
}
export const byClass = (root: FakeNode, name: string) => find(root, (n) => n.hasClass(name));

export function textNode(value: string) {
  const node = new FakeNode("#text");
  node.nodeType = 3;
  node.text = value;
  return node;
}

export type Env = {
  window: any;
  document: any;
  body: FakeNode;
  head: FakeNode;
  /** Fire a window event, e.g. beforeinstallprompt or appinstalled. */
  fire: (type: string, event?: Record<string, unknown>) => void;
  /** Change which media queries match, then fire their change listeners. */
  setMedia: (matching: string[]) => void;
  style: { html: string; body: string };
  /** The page scroller (document.scrollingElement). Set its scrollTop to move the page. */
  scroller: FakeNode;
  /** Sends a touch event to the document, like the browser does for a finger at `points` (clientX, clientY). Returns the event. */
  touch: (type: "touchstart" | "touchmove" | "touchend" | "touchcancel", points?: [number, number][]) => { defaultPrevented: boolean };
};

export type EnvOptions = {
  userAgent?: string;
  maxTouchPoints?: number;
  standalone?: boolean;
  media?: string[];
  /** Pass a storage to share it between two visits, or "blocked" for storage that throws. */
  sessionStorage?: Storage | "blocked";
  localStorage?: Storage | "blocked";
  htmlBackground?: string;
  bodyBackground?: string;
};

/** A Storage stand-in that records every call. */
export function fakeStorage() {
  const data = new Map<string, string>();
  const calls: string[] = [];
  const storage = {
    getItem: (key: string) => (calls.push(`get ${key}`), data.get(key) ?? null),
    setItem: (key: string, value: string) => (calls.push(`set ${key}`), void data.set(key, value)),
    removeItem: (key: string) => (calls.push(`remove ${key}`), void data.delete(key)),
  };
  return { storage: storage as unknown as Storage, calls, data };
}

const blocked = () =>
  ({
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  }) as unknown as Storage;

/** Loads app-kit scripts into a fresh fake browser. Returns that browser. */
export function loadKit(files: string[], options: EnvOptions = {}): Env {
  const html = new FakeNode("html");
  const head = new FakeNode("head");
  const body = new FakeNode("body");
  html.appendChild(head);
  html.appendChild(body);

  let matching = new Set(options.media ?? []);
  const mediaListeners = new Map<string, Listener[]>();
  const windowListeners = new Map<string, Listener[]>();
  const style = { html: options.htmlBackground ?? "rgba(0, 0, 0, 0)", body: options.bodyBackground ?? "rgba(0, 0, 0, 0)" };

  const scroller = new FakeNode("html");
  const document = {
    documentElement: html,
    scrollingElement: scroller,
    head,
    body,
    readyState: "complete",
    createElement: (tag: string) => new FakeNode(tag),
    createTextNode: (value: string) => textNode(value),
    getElementById: (id: string) => find(html, (n) => n.id === id),
    querySelectorAll: (selector: string) => {
      if (selector === 'meta[name="theme-color"]') return head.children.filter((n) => n.tagName === "META" && n.getAttribute("name") === "theme-color");
      return [];
    },
    // Real listeners, so touch events can be sent through them.
    listeners: new Map<string, Listener[]>(),
    addEventListener: (type: string, fn: Listener) => FakeNode.prototype.addEventListener.call(document, type, fn),
    removeEventListener: (type: string, fn: Listener) => FakeNode.prototype.removeEventListener.call(document, type, fn),
    dispatch: (type: string, event?: Record<string, unknown>) => FakeNode.prototype.dispatch.call(document, type, event),
  };

  const sandbox: Record<string, unknown> = {
    document,
    navigator: { userAgent: options.userAgent ?? "", maxTouchPoints: options.maxTouchPoints ?? 0, standalone: options.standalone },
    matchMedia: (query: string) => ({
      get matches() {
        return matching.has(query);
      },
      addEventListener: (_type: string, fn: Listener) => mediaListeners.set(query, [...(mediaListeners.get(query) ?? []), fn]),
    }),
    getComputedStyle: (el: FakeNode) => ({ backgroundColor: el === html ? style.html : style.body }),
    addEventListener: (type: string, fn: Listener) => windowListeners.set(type, [...(windowListeners.get(type) ?? []), fn]),
    removeEventListener: () => {},
    setTimeout,
    clearTimeout,
    Promise,
  };
  const storageProp = (name: "sessionStorage" | "localStorage", value: Storage | "blocked" | undefined) => {
    const real = value === "blocked" ? blocked() : (value ?? fakeStorage().storage);
    sandbox[name] = real;
  };
  storageProp("sessionStorage", options.sessionStorage);
  storageProp("localStorage", options.localStorage);
  sandbox.window = sandbox;
  vm.createContext(sandbox);

  for (const file of files) {
    const source = fs.readFileSync(new URL(`../public/app-kit/${file}`, import.meta.url), "utf8");
    vm.runInContext(source, sandbox, { filename: file });
  }

  return {
    window: sandbox,
    document,
    body,
    head,
    style,
    scroller,
    touch: (type, points = []) => document.dispatch(type, { touches: points.map(([clientX, clientY]) => ({ clientX, clientY })) }),
    fire: (type, event = {}) => {
      for (const fn of windowListeners.get(type) ?? []) fn({ type, preventDefault() {}, ...event });
    },
    setMedia: (next) => {
      matching = new Set(next);
      for (const fns of mediaListeners.values()) for (const fn of fns) fn({ type: "change" });
    },
  };
}
