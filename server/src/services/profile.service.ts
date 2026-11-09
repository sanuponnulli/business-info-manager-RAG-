import { HttpError } from "../lib/httpError.js";
import { toMyProfile } from "../mappers/employee.mapper.js";
import * as employees from "../repositories/employee.repository.js";

/**
 * GET /me: the signed-in employee's own profile. Takes the id from the
 * verified token, never from the request, so nobody can ask for someone else's.
 */
export async function getMyProfile(employeeId: number) {
  const row = await employees.findMyProfileById(employeeId);
  if (!row) throw new HttpError(404, "not_found", "Employee not found");
  return toMyProfile(row);
}
