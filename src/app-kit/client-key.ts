/** The part of a Node request that clientKey reads. A real http.IncomingMessage fits. */
export type ClientKeyRequest = {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string | undefined } | null;
};

/**
 * Client address for the rate limiters.
 * Railway's proxy appends the address it actually accepted, so the rightmost
 * X-Forwarded-For hop is that client. A left-hand value is whatever the caller
 * sent and is not trusted. With no forwarding header, the socket address is used.
 *
 * Only use this behind a proxy that appends to X-Forwarded-For (Railway). On a
 * server that is reachable directly, a caller can send any header it likes.
 * If the rightmost hop is not a plain address, the socket address is used instead.
 */
export function clientKey(req: ClientKeyRequest): string {
  const hop = rightmostForwarded(forwardedHeader(req.headers["x-forwarded-for"]));
  if (hop) return hop;
  return req.socket?.remoteAddress || "unknown";
}

/** Several header lines count as one list, in order, so the last hop is the proxy's. */
function forwardedHeader(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join(",");
  return value ?? "";
}

function rightmostForwarded(header: string): string {
  const hop = header.split(",").map((part) => part.trim()).filter(Boolean).at(-1) ?? "";
  if (!hop || hop.length > 128 || /[\s/]/.test(hop)) return "";
  return hop;
}
