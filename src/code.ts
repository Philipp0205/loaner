import crypto from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function fromAlphabet(length: number): string {
  return Array.from(crypto.randomBytes(length), (byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

/** A group invite code used in /join/<code>. */
export function newInviteCode(): string {
  return fromAlphabet(10);
}

export function newId(): string {
  return crypto.randomBytes(9).toString("base64url");
}
