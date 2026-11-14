/** Calendar date in a timezone, as YYYY-MM-DD. */
export function isoDate(ms: number, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** True for a real YYYY-MM-DD day. "2026-02-30" is not. */
export function isCalendarDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === iso;
}

/** Calendar days from `from` to `to`. Works on dates, so DST never shifts it. */
export function daysBetween(from: string, to: string): number {
  const utc = (iso: string) => {
    const [year, month, day] = iso.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "14 Nov" for text in notifications. */
export function shortDate(iso: string): string {
  const [, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]}`;
}

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function assertTimeZone(tz: string): void {
  if (!isTimeZone(tz)) throw new Error(`Invalid APP_TZ: ${tz}`);
}
