import { prisma } from "../clients/prisma.js";
import type { LeaveType, Prisma } from "../generated/prisma/client.js";
import { yearRange } from "../lib/dates.js";
import { refSelect } from "./employee.repository.js";

/** Leave balances and requests. Callers (services) decide whose rows may be read. */

export function findBalances(employeeId: number, year: number, leaveType?: LeaveType) {
  return prisma.leaveBalance.findMany({
    where: { employeeId, year, ...(leaveType && { leaveType }) },
    select: { leaveType: true, year: true, entitled: true, carriedOver: true, used: true },
    orderBy: { leaveType: "asc" },
  });
}

/** Days in PENDING requests starting in `year`, per leave type: not yet subtracted from the balance. */
export async function pendingDaysByType(employeeId: number, year: number): Promise<Map<LeaveType, Prisma.Decimal>> {
  const { start, end } = yearRange(year);
  const groups = await prisma.leaveRequest.groupBy({
    by: ["leaveType"],
    where: { employeeId, status: "PENDING", startDate: { gte: start, lt: end } },
    _sum: { days: true },
  });
  return new Map(groups.flatMap((g) => (g._sum.days ? [[g.leaveType, g._sum.days] as const] : [])));
}

const requestSelect = {
  id: true,
  leaveType: true,
  startDate: true,
  endDate: true,
  days: true,
  reason: true,
  status: true,
  createdAt: true,
  decidedAt: true,
  decisionNote: true,
  employee: { select: refSelect },
  approver: { select: refSelect },
} satisfies Prisma.LeaveRequestSelect;

export type LeaveRequestRow = Prisma.LeaveRequestGetPayload<{ select: typeof requestSelect }>;

/** Requests matching `where` (which includes the service's access filter), earliest start first unless told otherwise. */
export async function findRequests(
  where: Prisma.LeaveRequestWhereInput,
  take: number,
  order: "asc" | "desc" = "asc",
): Promise<{ rows: LeaveRequestRow[]; total: number }> {
  // Two separate queries in parallel (a page and a count); they don't need to be one transaction.
  const [rows, total] = await Promise.all([
    prisma.leaveRequest.findMany({ where, take, orderBy: [{ startDate: order }, { id: order }], select: requestSelect }),
    prisma.leaveRequest.count({ where }),
  ]);
  return { rows, total };
}
