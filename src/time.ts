/** Date helpers come from the app-kit. The label formatter below is product copy, so it stays here. */
export { addDays, assertTimeZone, isCalendarDate, isoDate } from "./app-kit/index.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "14 Nov" for text in notifications. */
export function shortDate(iso: string): string {
  const [, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]}`;
}
