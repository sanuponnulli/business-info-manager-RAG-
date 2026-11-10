import { toDateString } from "../lib/dates.js";
import type { EmployeeRefRow, EmployeeSummaryRow, MyProfileRow } from "../repositories/employee.repository.js";

/**
 * Database rows → API response shapes (the schemas in docs/hr-openapi.yaml).
 * Keeping this separate means a column rename changes one mapper, not
 * every endpoint, and the API never leaks a field just because it exists.
 */

export function toEmployeeRef(row: EmployeeRefRow) {
  return { id: row.id, name: `${row.firstName} ${row.lastName}`, jobTitle: row.jobTitle };
}

export function toEmployeeSummary(row: EmployeeSummaryRow) {
  return {
    id: row.id,
    employeeCode: row.employeeCode,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    jobTitle: row.jobTitle,
    department: row.department,
    location: row.location,
  };
}

export function toMyProfile(row: MyProfileRow) {
  return {
    ...toEmployeeSummary(row),
    phone: row.phone,
    role: row.role,
    employmentType: row.employmentType,
    status: row.status,
    hireDate: toDateString(row.hireDate),
    manager: row.manager ? toEmployeeRef(row.manager) : null,
    directReportCount: row._count.directReports,
  };
}
