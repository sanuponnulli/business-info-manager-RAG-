import { canSeeEmploymentDetails, directoryScope } from "../auth/permissions.js";
import type { Prisma } from "../generated/prisma/client.js";
import { toDateString } from "../lib/dates.js";
import { HttpError } from "../lib/httpError.js";
import { toEmployeeRef } from "../mappers/employee.mapper.js";
import type { AuthUser } from "../middleware/userAuth.js";
import * as employees from "../repositories/employee.repository.js";

/**
 * Company directory search. Every signed-in employee can find colleagues'
 * names, titles, emails, departments, offices and managers. Hire date,
 * contract type and status (e.g. on parental leave) are added only where
 * canSeeEmploymentDetails allows: for HR, and for a manager's own reports.
 */
export async function findColleagues(actor: AuthUser, opts: { query?: string; department?: string; limit: number }) {
  const terms = (opts.query ?? "").split(/\s+/).filter(Boolean).slice(0, 4);
  if (terms.length === 0 && !opts.department) {
    throw new HttpError(400, "invalid_request", "Give a name, job title or department to search for");
  }

  // Every word must match somewhere: "arjun menon" finds first name Arjun + last name Menon.
  const where: Prisma.EmployeeWhereInput = {
    AND: [
      directoryScope(actor),
      ...terms.map((term) => ({
        OR: (["firstName", "lastName", "email", "jobTitle"] as const).map((field) => ({
          [field]: { contains: term, mode: "insensitive" as const },
        })),
      })),
      ...(opts.department
        ? [{
            department: {
              OR: [
                { code: { equals: opts.department, mode: "insensitive" as const } },
                { name: { contains: opts.department, mode: "insensitive" as const } },
              ],
            },
          }]
        : []),
    ],
  };

  const { rows, total } = await employees.searchEmployees(where, opts.limit);
  return {
    total,
    employees: rows.map((row) => ({
      ...toEmployeeRef(row),
      email: row.email,
      department: row.department.name,
      office: row.location.name,
      manager: row.manager ? toEmployeeRef(row.manager) : null,
      ...(canSeeEmploymentDetails(actor, row) && {
        hireDate: toDateString(row.hireDate),
        employmentType: row.employmentType,
        status: row.status,
      }),
    })),
  };
}
