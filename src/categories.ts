/** Item categories. Keep in sync with public/categories.js (this app has no bundler). Same strings, same order. */
export const CATEGORIES = ["Tools", "Kitchen", "Camping", "Sports", "Garden", "Electronics", "Kids", "Household", "Other"] as const;

export type Category = (typeof CATEGORIES)[number];

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}
