import type http from "node:http";

/**
 * Client address for the rate limiters.
 * Railway's proxy appends the address it actually accepted, so the rightmost
 * X-Forwarded-For hop is that client. A left-hand value is whatever the caller
 * sent and is not trusted. With no forwarding header, the socket address is used.
 */
export function clientKey(req: http.IncomingMessage): string {
  const hop = rightmostForwarded(headerValue(req.headers["x-forwarded-for"]));
  if (hop) return hop;
  return req.socket?.remoteAddress || "unknown";
}

function headerValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function rightmostForwarded(header: string): string {
  const hop = header.split(",").map((part) => part.trim()).filter(Boolean).at(-1) ?? "";
  if (!hop || hop.length > 128 || /[\s/]/.test(hop)) return "";
  return hop;
}
