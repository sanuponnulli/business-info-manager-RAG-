/**
 * HR dates are calendar dates (Postgres DATE), which Prisma represents as
 * midnight UTC. These helpers keep everything in UTC so a date never shifts
 * by a day because of the server's time zone.
 */

/** Date → "YYYY-MM-DD". */
export const toDateString = (date: Date): string => date.toISOString().slice(0, 10);

/** "YYYY-MM-DD" → Date at midnight UTC. */
export const parseDate = (value: string): Date => new Date(`${value}T00:00:00Z`);

/** Today as "YYYY-MM-DD" (UTC). */
export const todayString = (): string => toDateString(new Date());

/** [1 Jan of year, 1 Jan of next year): use as { gte: start, lt: end }. */
export function yearRange(year: number): { start: Date; end: Date } {
  return { start: new Date(Date.UTC(year, 0, 1)), end: new Date(Date.UTC(year + 1, 0, 1)) };
}

/** Adds whole days to a "YYYY-MM-DD" date. */
export function addDays(value: string, days: number): string {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateString(date);
}
