import type { CoverageLevel, Prisma } from "../generated/prisma/client.js";
import { parseDate, toDateString } from "../lib/dates.js";
import type { AuthUser } from "../middleware/userAuth.js";
import * as benefits from "../repositories/benefit.repository.js";

type Plan = Awaited<ReturnType<typeof benefits.findActiveEnrollments>>[number]["plan"];

const COST_FIELD: Record<CoverageLevel, (plan: Plan) => Prisma.Decimal> = {
  EMPLOYEE_ONLY: (p) => p.costEmployeeOnly,
  EMPLOYEE_SPOUSE: (p) => p.costEmployeeSpouse,
  FAMILY: (p) => p.costFamily,
};

/** The caller's own active benefit enrollments and what each costs them per month. */
export async function getMyBenefits(actor: AuthUser, opts: { today: string }) {
  const rows = await benefits.findActiveEnrollments(actor.id, parseDate(opts.today));
  return {
    enrollments: rows.map((r) => ({
      plan: r.plan.name,
      category: r.plan.category,
      provider: r.plan.provider,
      description: r.plan.description,
      coverageLevel: r.coverageLevel,
      dependents: r.dependents,
      since: toDateString(r.startDate),
      monthlyCost: COST_FIELD[r.coverageLevel](r.plan).toFixed(2),
      currency: r.plan.currency,
    })),
  };
}
