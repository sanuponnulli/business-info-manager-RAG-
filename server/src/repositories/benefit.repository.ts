import { prisma } from "../clients/prisma.js";

/** Benefit enrollments that are active on `onDate` (started, and not ended before it). */
export function findActiveEnrollments(employeeId: number, onDate: Date) {
  return prisma.benefitEnrollment.findMany({
    where: {
      employeeId,
      startDate: { lte: onDate },
      OR: [{ endDate: null }, { endDate: { gte: onDate } }],
    },
    orderBy: { plan: { category: "asc" } },
    select: {
      coverageLevel: true,
      dependents: true,
      startDate: true,
      plan: {
        select: {
          name: true,
          category: true,
          provider: true,
          description: true,
          currency: true,
          costEmployeeOnly: true,
          costEmployeeSpouse: true,
          costFamily: true,
        },
      },
    },
  });
}
