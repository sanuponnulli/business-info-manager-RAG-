import { Prisma } from "../generated/prisma/client.js";
import { toDateString } from "../lib/dates.js";
import type { AuthUser } from "../middleware/userAuth.js";
import * as pay from "../repositories/pay.repository.js";

/** Money goes out as a 2-decimal string ("178958.34"), never a float. */
const money = (value: Prisma.Decimal) => value.toFixed(2);

/**
 * The caller's own payslips for a year, plus year-to-date totals.
 * There is deliberately no way to pass another employee's id.
 */
export async function getMyPay(actor: AuthUser, opts: { year: number }) {
  const slips = await pay.findPayslips(actor.id, opts.year);
  if (slips.length === 0) return { year: opts.year, payslips: [], totals: null };

  const sum = (pick: (s: (typeof slips)[number]) => Prisma.Decimal) =>
    money(slips.reduce((acc, s) => acc.plus(pick(s)), new Prisma.Decimal(0)));

  return {
    year: opts.year,
    currency: slips[0].currency,
    payslips: slips.map((s) => ({
      month: toDateString(s.periodStart).slice(0, 7),
      payDate: toDateString(s.payDate),
      basePay: money(s.basePay),
      allowances: money(s.allowances),
      bonus: money(s.bonus),
      grossPay: money(s.grossPay),
      tax: money(s.tax),
      deductions: money(s.deductions),
      netPay: money(s.netPay),
    })),
    totals: {
      months: slips.length,
      grossPay: sum((s) => s.grossPay),
      bonus: sum((s) => s.bonus),
      tax: sum((s) => s.tax),
      deductions: sum((s) => s.deductions),
      netPay: sum((s) => s.netPay),
    },
  };
}
