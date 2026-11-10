import { prisma } from "../clients/prisma.js";
import { yearRange } from "../lib/dates.js";

/** Payslips. Only ever queried for the signed-in employee's own id. */
export function findPayslips(employeeId: number, year: number) {
  const { start, end } = yearRange(year);
  return prisma.payslip.findMany({
    where: { employeeId, periodStart: { gte: start, lt: end } },
    orderBy: { periodStart: "asc" },
    select: {
      periodStart: true,
      payDate: true,
      currency: true,
      basePay: true,
      allowances: true,
      bonus: true,
      grossPay: true,
      tax: true,
      deductions: true,
      netPay: true,
    },
  });
}
