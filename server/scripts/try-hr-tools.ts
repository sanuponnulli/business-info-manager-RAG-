/**
 * Manual check: runs the HR tools against the real database as each demo
 * user, so you can see what each role gets back, and what it's refused.
 * No Gemini involved. Needs the hr-db container running and seeded.
 *
 *   npx tsx --env-file=.env scripts/try-hr-tools.ts
 */
import type { FunctionCall } from "@google/genai";
import { pino } from "pino";
import { prisma } from "../src/clients/prisma.js";
import { todayString } from "../src/lib/dates.js";
import type { AuthUser } from "../src/middleware/userAuth.js";
import { executeToolCalls, toolDeclarationsFor } from "../src/tools/registry.js";

const log = pino({ level: "silent" });
const today = todayString();

async function userFor(email: string): Promise<AuthUser> {
  const e = await prisma.employee.findUniqueOrThrow({ where: { email }, select: { id: true, role: true } });
  return e;
}

async function run(label: string, user: AuthUser | null, name: string, args: Record<string, unknown> = {}) {
  const [r] = await executeToolCalls([{ id: "x", name, args } as FunctionCall], { user, today }, [], log);
  const body = r.response as { result?: unknown; error?: string };
  const text = body.error ? `ERROR ${body.error}` : JSON.stringify(body.result);
  console.log(`  ${label.padEnd(44)} ${text.length > 150 ? `${text.slice(0, 150)}…` : text}`);
}

const employee = await userFor("employee@acme.test");
const manager = await userFor("manager@acme.test");
const hr = await userFor("hr@acme.test");

for (const [who, user] of [["anonymous", null], ["employee", employee], ["manager", manager], ["hr", hr]] as const) {
  console.log(`${who}: tools = ${toolDeclarationsFor(user).map((d) => d.name).join(", ")}`);
}

console.log(`\nemployee (Sneha, id ${employee.id})`);
await run("get_my_leave_balances", employee, "get_my_leave_balances");
await run("list_my_leave_requests status=PENDING", employee, "list_my_leave_requests", { status: "PENDING" });
await run("get_my_holidays", employee, "get_my_holidays");
await run("get_my_pay (totals)", employee, "get_my_pay", { year: 2026 });
await run("get_my_benefits", employee, "get_my_benefits");
await run("find_colleagues 'arjun' (no hire date)", employee, "find_colleagues", { query: "arjun" });
await run("get_team_leave → refused", employee, "get_team_leave");
await run("get_my_pay with employeeId of manager", employee, "get_my_pay", { year: 2026, employeeId: manager.id });

console.log(`\nmanager (Arjun, id ${manager.id})`);
await run("get_team_leave (direct reports only)", manager, "get_team_leave");
await run("get_team_leave status=PENDING", manager, "get_team_leave", { status: "PENDING", to: "2027-01-31" });
await run("find_colleagues 'sneha' (own report: details)", manager, "find_colleagues", { query: "sneha" });

console.log(`\nhr (Fatima, id ${hr.id})`);
await run("get_team_leave department=Finance", hr, "get_team_leave", { department: "Finance" });

console.log("\nanonymous");
await run("get_my_leave_balances → refused", null, "get_my_leave_balances");

// Cross-check against plain SQL: every request the manager sees must be from a direct report.
const seen = await executeToolCalls([{ id: "y", name: "get_team_leave", args: { to: "2027-02-06" } }], { user: manager, today }, [], log);
const ids = ((seen[0].response as { result: { requests: { employee: { id: number } }[] } }).result.requests).map((r) => r.employee.id);
const reports = new Set((await prisma.employee.findMany({ where: { managerId: manager.id }, select: { id: true } })).map((e) => e.id));
console.log(`\nSQL check: manager saw ${ids.length} requests, all from direct reports: ${ids.every((id) => reports.has(id))}`);

await prisma.$disconnect();
