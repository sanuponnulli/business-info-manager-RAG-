import { parseDate, toDateString } from "../lib/dates.js";
import { HttpError } from "../lib/httpError.js";
import type { AuthUser } from "../middleware/userAuth.js";
import * as employees from "../repositories/employee.repository.js";
import * as holidays from "../repositories/holiday.repository.js";

/** Public holidays at the caller's own office for a year; optionally only those from today on. */
export async function getMyHolidays(actor: AuthUser, opts: { year: number; upcomingOnly: boolean; today: string }) {
  const office = await employees.findLocationOf(actor.id);
  if (!office) throw new HttpError(404, "not_found", "Employee not found");

  const yearStart = `${opts.year}-01-01`;
  const from = opts.upcomingOnly && opts.today > yearStart ? opts.today : yearStart;
  const rows = await holidays.findHolidays(office.id, parseDate(from), parseDate(`${opts.year}-12-31`));

  return {
    office: office.name,
    country: office.country,
    year: opts.year,
    holidays: rows.map((h) => ({ date: toDateString(h.date), name: h.name })),
  };
}
