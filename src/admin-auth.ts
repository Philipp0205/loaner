import crypto from "node:crypto";
import { HttpError, type Req } from "./types.js";

/** Constant-time compare. Both sides are hashed first, so the length does not leak either. */
export function adminTokensMatch(given: string, expected: string): boolean {
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * Gate for admin routes. Answers 404 whether the token is unset, missing or wrong,
 * so the endpoint does not show that it exists. A device token never passes.
 */
export function requireAdmin(req: Req): void {
  const expected = req.ctx.config.adminToken;
  const match = /^Bearer\s+(\S+)$/i.exec((req.raw.headers.authorization ?? "").trim());
  if (!expected || !match || !adminTokensMatch(match[1], expected)) throw new HttpError(404, "not found");
}
