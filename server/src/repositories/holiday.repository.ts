import { prisma } from "../clients/prisma.js";

/** Public holidays of one office between two dates (inclusive). */
export function findHolidays(locationId: number, from: Date, to: Date) {
  return prisma.holiday.findMany({
    where: { locationId, date: { gte: from, lte: to } },
    orderBy: { date: "asc" },
    select: { date: true, name: true },
  });
}
