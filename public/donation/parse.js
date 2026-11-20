import { DONATION_COPY } from "./copy.js";

// An amount: digits with an optional decimal part, and an optional euro sign or EUR before or after.
const AMOUNT = /^(?:€|eur)?\s*(\d+(?:[.,]\d+)?)\s*(?:€|eur)?$/i;

/**
 * What the person typed as a suggested donation. Returns { amount } for a number (comma or dot, with an
 * optional euro sign), { text } for words, or { error } when it is empty. The server checks range and decimals.
 */
export function parseDonation(raw) {
  const value = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!value) return { error: DONATION_COPY.empty };
  const match = AMOUNT.exec(value);
  if (match) return { amount: Number(match[1].replace(",", ".")) };
  return { text: value };
}

/** The API fields for a parsed donation: an amount, words, or neither. */
export function donationFields(parsed) {
  if (parsed && parsed.amount !== undefined) return { donation: parsed.amount, donationText: null };
  if (parsed && parsed.text !== undefined) return { donation: null, donationText: parsed.text };
  return { donation: null, donationText: null };
}
