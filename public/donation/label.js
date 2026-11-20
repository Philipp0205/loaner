import { fmtAmount } from "../util.js";

/** True when the item suggests a donation, as an amount or in words. */
export function hasDonation(item) {
  return item.donation !== null && item.donation !== undefined ? true : !!item.donationText;
}

/** The suggested donation as shown: "€5", "€12.50" or the words ("a beer"). Empty when there is none. */
export function donationLabel(item) {
  if (item.donation !== null && item.donation !== undefined) return fmtAmount(item.donation);
  return item.donationText || "";
}

/** What the form input starts with: the plain number, or the words. Empty when there is none. */
export function donationInputValue(item) {
  if (!item) return "";
  if (item.donation !== null && item.donation !== undefined) return Number.isInteger(item.donation) ? String(item.donation) : item.donation.toFixed(2);
  return item.donationText || "";
}
