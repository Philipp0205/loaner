/**
 * Content-Security-Policy builder. The kit does not know an app's CDNs, so the app passes
 * its own allowlists, one entry per directive, keyed by the directive name:
 *
 *   buildCsp({
 *     "script-src": ["'self'", "https://cdn.example.com"],
 *     "connect-src": ["'self'", "https://api.example.com"],
 *     "frame-ancestors": false,          // drop a default
 *     "upgrade-insecure-requests": true, // a directive with no value
 *   })
 *
 * A directive you pass replaces the default for that directive, it is not merged.
 * Each array item is one source expression. An item with `;`, `,`, whitespace or a control
 * character throws, so a value can never add a directive or a second source.
 */

export type CspOptions = Record<string, readonly string[] | boolean | undefined>;

/** Strict defaults. */
export const CSP_DEFAULTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "default-src": Object.freeze(["'self'"]),
  "object-src": Object.freeze(["'none'"]),
  "base-uri": Object.freeze(["'self'"]),
  "frame-ancestors": Object.freeze(["'none'"]),
});

const DIRECTIVE_RE = /^[a-z][a-z0-9-]*$/;
// Anything outside printable ASCII without space, `;` and `,`. Covers newlines, tabs, NUL and unicode separators.
const SOURCE_RE = /^[\x21-\x7e]+$/;

export function buildCsp(options: CspOptions = {}): string {
  const merged = new Map<string, readonly string[] | true>();
  for (const [name, values] of Object.entries(CSP_DEFAULTS)) merged.set(name, values);

  for (const [name, value] of Object.entries(options)) {
    if (!DIRECTIVE_RE.test(name)) throw new Error(`invalid CSP directive name: ${JSON.stringify(name)}`);
    if (value === undefined) continue;
    if (value === false) {
      merged.delete(name);
    } else if (value === true) {
      merged.set(name, true);
    } else if (Array.isArray(value)) {
      if (value.length === 0) throw new Error(`CSP directive ${name} has no sources. Use "'none'" to allow nothing.`);
      for (const source of value) checkSource(name, source);
      merged.set(name, value);
    } else {
      throw new Error(`CSP directive ${name} must be an array of sources, true or false`);
    }
  }

  const parts: string[] = [];
  for (const [name, value] of merged) parts.push(value === true ? name : `${name} ${value.join(" ")}`);
  return parts.join("; ");
}

function checkSource(directive: string, source: unknown): void {
  if (typeof source !== "string" || !SOURCE_RE.test(source) || source.includes(";") || source.includes(",")) {
    throw new Error(`invalid CSP source in ${directive}: ${JSON.stringify(source)}`);
  }
}
