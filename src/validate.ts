import { HttpError } from "./types.js";
import { isCategory } from "./categories.js";
import { isCalendarDate } from "./time.js";

export function str(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

/** A trimmed string of min..max characters (counted as code points). */
export function text(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== "string") throw new HttpError(400, `${label} is required`);
  const trimmed = value.trim().replace(/\s+/g, " ");
  const length = [...trimmed].length;
  if (length < min || length > max) {
    throw new HttpError(400, min === 0 ? `${label} must be at most ${max} characters` : `${label} must be ${min} to ${max} characters`);
  }
  return trimmed;
}

/** Free text such as a note or message: keeps line breaks, trims, 0..max characters. */
export function longText(value: unknown, label: string, max: number): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new HttpError(400, `${label} must be text`);
  const trimmed = value.trim();
  if ([...trimmed].length > max) throw new HttpError(400, `${label} must be at most ${max} characters`);
  return trimmed;
}

/** Like longText, but empty (or missing) is a 400. Line breaks inside are kept. */
export function requiredLongText(value: unknown, label: string, max: number): string {
  const trimmed = longText(value, label, max);
  if (!trimmed) throw new HttpError(400, `${label} is required`);
  return trimmed;
}

export const MAX_DONATION = 10_000;

/** null or absent means no donation. Otherwise a number above 0 with at most 2 decimals; returns cents. */
export function donationCents(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new HttpError(400, "donation must be a number");
  if (value <= 0) throw new HttpError(400, "donation must be more than 0");
  if (value > MAX_DONATION) throw new HttpError(400, `donation must be at most ${MAX_DONATION}`);
  const cents = Math.round(value * 100);
  if (Math.abs(cents / 100 - value) > 1e-9) throw new HttpError(400, "donation can have at most 2 decimals");
  return cents;
}

export function centsToAmount(cents: number | null): number | null {
  return cents === null ? null : cents / 100;
}

/** A category from the fixed list. null or an empty string clears it. Anything else is a 400. */
export function categoryValue(value: unknown): string | null {
  if (value === null || value === "") return null;
  if (!isCategory(value)) throw new HttpError(400, "category must be one of the listed categories");
  return value;
}

export function date(value: unknown, label: string): string {
  if (typeof value !== "string" || !isCalendarDate(value)) throw new HttpError(400, `${label} must be a date as YYYY-MM-DD`);
  return value;
}

export function stringArray(value: unknown, label: string, max: number): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new HttpError(400, `${label} must be a list`);
  }
  const unique = [...new Set(value as string[])];
  if (unique.length > max) throw new HttpError(400, `${label} has too many entries`);
  return unique;
}
