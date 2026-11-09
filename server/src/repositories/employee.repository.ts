import { prisma } from "../clients/prisma.js";
import type { Prisma } from "../generated/prisma/client.js";

/**
 * Database access for employees. Repositories only fetch and store rows:
 * no HTTP, no permission rules, no response shaping. That keeps every query
 * in one place, and lets services be tested with a fake repository.
 *
 * Each `select` lists exactly the columns a caller needs, so a query never
 * pulls password hashes or other fields it has no use for.
 */

const refSelect = { id: true, firstName: true, lastName: true, jobTitle: true } satisfies Prisma.EmployeeSelect;

const summarySelect = {
  id: true,
  employeeCode: true,
  firstName: true,
  lastName: true,
  email: true,
  jobTitle: true,
  department: { select: { id: true, code: true, name: true } },
  location: { select: { id: true, code: true, name: true } },
} satisfies Prisma.EmployeeSelect;

const myProfileSelect = {
  ...summarySelect,
  phone: true,
  role: true,
  employmentType: true,
  status: true,
  hireDate: true,
  manager: { select: refSelect },
  _count: { select: { directReports: { where: { status: { not: "TERMINATED" } } } } },
} satisfies Prisma.EmployeeSelect;

export type EmployeeRefRow = Prisma.EmployeeGetPayload<{ select: typeof refSelect }>;
export type EmployeeSummaryRow = Prisma.EmployeeGetPayload<{ select: typeof summarySelect }>;
export type MyProfileRow = Prisma.EmployeeGetPayload<{ select: typeof myProfileSelect }>;

/** For login: the only query that reads password_hash. */
export function findCredentialsByEmail(email: string) {
  return prisma.employee.findUnique({
    where: { email },
    select: { id: true, passwordHash: true, status: true },
  });
}

/** For the auth middleware, on every request: is this employee still allowed in, and with which role? */
export function findAuthInfo(id: number) {
  return prisma.employee.findUnique({ where: { id }, select: { id: true, role: true, status: true } });
}

export function findSummaryById(id: number): Promise<EmployeeSummaryRow | null> {
  return prisma.employee.findUnique({ where: { id }, select: summarySelect });
}

export function findMyProfileById(id: number): Promise<MyProfileRow | null> {
  return prisma.employee.findUnique({ where: { id }, select: myProfileSelect });
}
