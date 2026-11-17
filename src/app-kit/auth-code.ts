import { createHash, randomInt } from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 12;
const MAX_EMAIL_LENGTH = 254;

/** A new recovery code, `XXXX-XXXX-XXXX`, from a 32-character alphabet without look-alikes (no I, O, 0, 1). */
export function generateRecoveryCode(): string {
  let raw = "";
  // randomInt draws from the CSPRNG and rejects values that would bias the result.
  for (let i = 0; i < CODE_LENGTH; i++) raw += ALPHABET[randomInt(ALPHABET.length)];
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

/**
 * What a person typed back to `XXXX-XXXX-XXXX`, or null. Non-alphanumerics are dropped and letters uppercased.
 * Exactly 12 characters, all from the code alphabet.
 */
export function normalizeRecoveryCode(input: string): string | null {
  if (typeof input !== "string") return null;
  const raw = input.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (raw.length !== CODE_LENGTH) return null;
  for (const char of raw) if (!ALPHABET.includes(char)) return null;
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

/** sha256 of the utf8 string, as lowercase hex. This is what is stored for every secret. */
export function hashSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Trimmed and lowercased, or null when it is not a plausible address (one `@`, a dot in the domain, no spaces, at most 254 chars). */
export function normalizeEmail(input: string): string | null {
  if (typeof input !== "string") return null;
  const email = input.trim().toLowerCase();
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH) return null;
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) return null;
  return email;
}

/** True when the user has no email yet (an account from before email was required). */
export function needsEmail(user: { email: string | null }): boolean {
  return user.email === null;
}
