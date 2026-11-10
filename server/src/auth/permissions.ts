import type { Prisma } from "../generated/prisma/client.js";
import { HttpError } from "../lib/httpError.js";
import type { AuthUser } from "../middleware/userAuth.js";

/**
 * Role-based access control for HR data, in one place.
 *
 *   EMPLOYEE  their own records; colleagues' names, titles and contact details
 *   MANAGER   + their direct reports' leave and employment details
 *   HR_ADMIN  everything, including terminated employees
 *
 * Pay, balances and benefits are always the caller's own: those queries take
 * the id from the verified token and never accept one from outside.
 *
 * Rules are enforced by turning them into database filters (WHERE clauses),
 * so a request can't see rows it isn't allowed to. It doesn't depend on
 * the caller, or the AI model, choosing to ask nicely.
 */

export const forbidden = (message: string) => new HttpError(403, "forbidden", message);

export const isHr = (actor: AuthUser) => actor.role === "HR_ADMIN";

/** Whose leave a caller may see besides their own. Throws for plain employees. */
export function teamScope(actor: AuthUser): Prisma.EmployeeWhereInput {
  switch (actor.role) {
    case "HR_ADMIN":
      return {}; // everyone
    case "MANAGER":
      return { managerId: actor.id }; // direct reports only
    default:
      throw forbidden("Only managers and HR can see other people's leave");
  }
}

/** Who appears in the directory: terminated employees only for HR. */
export function directoryScope(actor: AuthUser): Prisma.EmployeeWhereInput {
  return isHr(actor) ? {} : { status: { not: "TERMINATED" } };
}

/**
 * Employment details of a colleague (hire date, contract type, status such as
 * being on parental leave): visible to HR, to that person's manager, and to
 * the person themselves.
 */
export function canSeeEmploymentDetails(actor: AuthUser, person: { id: number; managerId: number | null }): boolean {
  return isHr(actor) || person.id === actor.id || person.managerId === actor.id;
}
