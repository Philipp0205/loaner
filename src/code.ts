import crypto from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function fromAlphabet(length: number): string {
  return Array.from(crypto.randomBytes(length), (byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

/** A recovery code, XXXX-XXXX-XXXX, avoiding ambiguous characters. */
export function recoveryCode(): string {
  const raw = fromAlphabet(12);
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

/** Normalises what a person typed or pasted into XXXX-XXXX-XXXX, or "" when it cannot be a code. */
export function normalizeRecoveryCode(input: string): string {
  const compact = input.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!/^[A-Z2-9]{12}$/.test(compact)) return "";
  return `${compact.slice(0, 4)}-${compact.slice(4, 8)}-${compact.slice(8, 12)}`;
}

/** A group invite code used in /join/<code>. */
export function newInviteCode(): string {
  return fromAlphabet(10);
}

export function newToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function newId(): string {
  return crypto.randomBytes(9).toString("base64url");
}

export function sha256(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
