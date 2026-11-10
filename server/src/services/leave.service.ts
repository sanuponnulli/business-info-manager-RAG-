import { teamScope } from "../auth/permissions.js";
import type { LeaveStatus, LeaveType, Prisma } from "../generated/prisma/client.js";
import { parseDate, toDateString, yearRange } from "../lib/dates.js";
import { HttpError } from "../lib/httpError.js";
import { toEmployeeRef } from "../mappers/employee.mapper.js";
import type { AuthUser } from "../middleware/userAuth.js";
import * as leave from "../repositories/leave.repository.js";

/** Longest window get_team_leave may ask for, so one call can't dump a whole year of everyone's leave. */
export const MAX_TEAM_RANGE_DAYS = 92;

/**
 * The caller's own balances. remaining = entitled + carried over - used;
 * available also subtracts days in pending requests, so it's the number that
 * answers "can I still book N days?".
 */
export async function getMyLeaveBalances(actor: AuthUser, opts: { year: number; leaveType?: LeaveType }) {
  const [balances, pending] = await Promise.all([
    leave.findBalances(actor.id, opts.year, opts.leaveType),
    leave.pendingDaysByType(actor.id, opts.year),
  ]);
  return {
    year: opts.year,
    balances: balances.map((b) => {
      const remaining = b.entitled.plus(b.carriedOver).minus(b.used);
      const pendingDays = pending.get(b.leaveType)?.toNumber() ?? 0;
      return {
        leaveType: b.leaveType,
        entitled: b.entitled.toNumber(),
        carriedOver: b.carriedOver.toNumber(),
        used: b.used.toNumber(),
        pending: pendingDays,
        remaining: remaining.toNumber(),
        available: remaining.minus(pendingDays).toNumber(),
      };
    }),
  };
}

/** The caller's own requests, newest first. */
export async function listMyLeaveRequests(
  actor: AuthUser,
  opts: { year?: number; status?: LeaveStatus; limit: number },
) {
  const where: Prisma.LeaveRequestWhereInput = { employeeId: actor.id };
  if (opts.status) where.status = opts.status;
  if (opts.year) {
    const { start, end } = yearRange(opts.year);
    where.startDate = { gte: start, lt: end };
  }
  const { rows, total } = await leave.findRequests(where, opts.limit, "desc");
  return { total, requests: rows.map(toLeaveRequest) };
}

/**
 * Leave of the people the caller manages, overlapping [from, to].
 * Managers see their direct reports, HR sees everyone, employees get a 403
 * (teamScope throws). The scope is part of the query, not a check afterwards.
 * Default statuses: pending and approved, i.e. who is (or may be) away.
 */
export async function getTeamLeave(
  actor: AuthUser,
  opts: { from: string; to: string; status?: LeaveStatus; department?: string; limit: number },
) {
  const scope = teamScope(actor); // first: an employee gets "forbidden", not a validation error

  const from = parseDate(opts.from);
  const to = parseDate(opts.to);
  const rangeDays = (to.getTime() - from.getTime()) / 86_400_000;
  if (rangeDays < 0) throw new HttpError(400, "invalid_request", "from must be on or before to");
  if (rangeDays > MAX_TEAM_RANGE_DAYS) {
    throw new HttpError(400, "invalid_request", `The date range can be at most ${MAX_TEAM_RANGE_DAYS} days`);
  }

  const employee: Prisma.EmployeeWhereInput = { ...scope };
  if (opts.department) {
    employee.department = {
      OR: [
        { code: { equals: opts.department, mode: "insensitive" } },
        { name: { contains: opts.department, mode: "insensitive" } },
      ],
    };
  }

  const { rows, total } = await leave.findRequests(
    {
      employee,
      startDate: { lte: to },
      endDate: { gte: from },
      status: opts.status ?? { in: ["PENDING", "APPROVED"] },
    },
    opts.limit,
  );
  return { from: opts.from, to: opts.to, total, requests: rows.map(toLeaveRequest) };
}

function toLeaveRequest(row: leave.LeaveRequestRow) {
  return {
    id: row.id,
    employee: toEmployeeRef(row.employee),
    leaveType: row.leaveType,
    startDate: toDateString(row.startDate),
    endDate: toDateString(row.endDate),
    days: row.days.toNumber(),
    status: row.status,
    reason: row.reason,
    submittedAt: row.createdAt.toISOString(),
    decidedBy: row.approver ? toEmployeeRef(row.approver) : null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decisionNote: row.decisionNote,
  };
}
