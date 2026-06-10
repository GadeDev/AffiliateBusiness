/** JST (UTC+9) time helpers. The DB stores ISO 8601 UTC strings. */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** YYYY-MM-DD for the current JST calendar day. */
export function jstDateString(now: Date = new Date()): string {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * UTC ISO string for a given JST hour:minute on the current JST day.
 * e.g. todayJstAtUtc(6) -> the instant of 06:00 JST today, expressed in UTC.
 */
export function todayJstAtUtc(hourJst: number, minuteJst = 0, now: Date = new Date()): string {
  const jstDay = jstDateString(now); // YYYY-MM-DD in JST
  const [y, m, d] = jstDay.split('-').map(Number);
  // 06:00 JST == (06 - 9):00 UTC == 21:00 UTC previous day. Date.UTC handles the rollover.
  const utcMs = Date.UTC(y, m - 1, d, hourJst - 9, minuteJst, 0);
  return new Date(utcMs).toISOString();
}

/** ISO string for `days` ago from now (UTC). */
export function daysAgoUtc(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}
