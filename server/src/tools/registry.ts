import { Type, type FunctionCall, type FunctionDeclaration, type FunctionResponse } from "@google/genai";
import type { Logger } from "pino";
import { z } from "zod";
import { HttpError } from "../lib/httpError.js";
import { addDays } from "../lib/dates.js";
import type { AuthUser } from "../middleware/userAuth.js";
import { findAuthInfo } from "../repositories/employee.repository.js";
import { getMyBenefits } from "../services/benefits.service.js";
import { findColleagues } from "../services/directory.service.js";
import { getMyHolidays } from "../services/holiday.service.js";
import { getMyLeaveBalances, getTeamLeave, listMyLeaveRequests, MAX_TEAM_RANGE_DAYS } from "../services/leave.service.js";
import { getMyPay } from "../services/pay.service.js";
import { getMyProfile } from "../services/profile.service.js";
import { formatContext, retrieveContext, type RetrievedChunk } from "../services/rag.service.js";

/**
 * Every tool the assistant (text chat and voice) can call, and who may call it.
 *
 *   public    anyone, even when not signed in: the handbook (vector search)
 *   employee  signed in: the caller's OWN HR records, plus the directory
 *   manager   MANAGER or HR_ADMIN: their team's leave
 *
 * Access is enforced three times, from the outside in:
 *   1. toolDeclarationsFor(user): the model is only TOLD about tools the user
 *      may use, so it doesn't try the others.
 *   2. executeToolCalls: re-checks the role (fresh from the database) before
 *      running anything, in case the model calls a tool it wasn't offered.
 *   3. The services scope every query to what the role allows (auth/permissions.ts).
 *
 * Identity always comes from the signed-in user, never from tool arguments:
 * no tool takes an employee id, so "show me Arjun's payslips" has no way in.
 */

export type ToolAccess = "public" | "employee" | "manager";

export interface ToolContext {
  /** Who is asking. null = not signed in. */
  user: AuthUser | null;
  /** "YYYY-MM-DD"; for default years and date ranges. */
  today: string;
}

/** HR tools return data; the handbook tool returns passages that the caller numbers for citations. */
type ToolOutput = { data: unknown } | { chunks: RetrievedChunk[] };

interface ToolDefinition<S extends z.ZodType = z.ZodType> {
  access: ToolAccess;
  declaration: FunctionDeclaration;
  /** Arguments come from the model, so they're validated like any user input. */
  args: S;
  run: (args: z.output<S>, ctx: ToolContext) => Promise<ToolOutput>;
}

const defineTool = <S extends z.ZodType>(tool: ToolDefinition<S>) => tool as unknown as ToolDefinition;

/** Tools other than handbook search only run with a signed-in user (executeToolCalls guarantees it). */
const me = (ctx: ToolContext): AuthUser => {
  if (!ctx.user) throw new HttpError(401, "unauthorized", "Not signed in");
  return ctx.user;
};
const yearOf = (ctx: ToolContext) => Number(ctx.today.slice(0, 4));

// --- Argument pieces --------------------------------------------------------

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(s)), "is not a real date");
const year = z.coerce.number().int().min(2000).max(2100).optional();
const LEAVE_TYPES = ["ANNUAL", "SICK", "PERSONAL", "PARENTAL", "UNPAID"] as const;
const LEAVE_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;

const yearParam = { type: Type.INTEGER, description: "Calendar year, e.g. 2026. Defaults to the current year." };
const leaveTypeParam = { type: Type.STRING, format: "enum", enum: [...LEAVE_TYPES], description: "Only this leave type." };
const statusParam = { type: Type.STRING, format: "enum", enum: [...LEAVE_STATUSES], description: "Only requests with this status." };

// --- The tools --------------------------------------------------------------

export const SEARCH_HANDBOOK = "search_handbook";

export const TOOLS: ToolDefinition[] = [
  defineTool({
    access: "public",
    declaration: {
      name: SEARCH_HANDBOOK,
      description:
        "Search the company employee handbook. Use it for every question about company policies and rules: leave, sick days, " +
        "benefits, pay, working hours, remote work, conduct or procedures. Returns the most relevant handbook passages. " +
        "It knows the rules, not anyone's personal records.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          query: {
            type: Type.STRING,
            description: "A short search phrase describing what to look up, e.g. 'sick leave days per year'.",
          },
        },
        required: ["query"],
      },
    },
    args: z.object({ query: z.string().trim().min(1).max(500) }),
    run: async ({ query }) => ({ chunks: (await retrieveContext(query)).chunks }),
  }),

  defineTool({
    access: "employee",
    declaration: {
      name: "get_my_profile",
      description:
        "The signed-in employee's own HR record: job title, department, office, manager, role, hire date, employment type " +
        "and number of direct reports.",
    },
    args: z.object({}),
    run: async (_args, ctx) => ({ data: await getMyProfile(me(ctx).id) }),
  }),

  defineTool({
    access: "employee",
    declaration: {
      name: "get_my_leave_balances",
      description:
        "The signed-in employee's leave balances from the HR system, per leave type: days entitled, carried over, used, " +
        "pending approval, remaining, and available (remaining minus pending). Use for 'how many days off do I have left?'.",
      parameters: { type: Type.OBJECT, properties: { year: yearParam, leaveType: leaveTypeParam } },
    },
    args: z.object({ year, leaveType: z.enum(LEAVE_TYPES).optional() }),
    run: async (args, ctx) => ({
      data: await getMyLeaveBalances(me(ctx), { year: args.year ?? yearOf(ctx), leaveType: args.leaveType }),
    }),
  }),

  defineTool({
    access: "employee",
    declaration: {
      name: "list_my_leave_requests",
      description:
        "The signed-in employee's own leave requests, newest first: dates, days, type, status (pending, approved, rejected, " +
        "cancelled) and who decided. Use for 'is my leave approved?' or 'when is my next time off?'.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          year: { ...yearParam, description: "Only requests starting in this year." },
          status: statusParam,
          limit: { type: Type.INTEGER, description: "How many to return, 1-20. Default 10." },
        },
      },
    },
    args: z.object({ year, status: z.enum(LEAVE_STATUSES).optional(), limit: z.coerce.number().int().min(1).max(20).default(10) }),
    run: async (args, ctx) => ({ data: await listMyLeaveRequests(me(ctx), args) }),
  }),

  defineTool({
    access: "employee",
    declaration: {
      name: "get_my_holidays",
      description: "Public holidays at the signed-in employee's own office for a year.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          year: yearParam,
          upcomingOnly: { type: Type.BOOLEAN, description: "Only holidays from today on. Default true." },
        },
      },
    },
    args: z.object({ year, upcomingOnly: z.boolean().default(true) }),
    run: async (args, ctx) => ({
      data: await getMyHolidays(me(ctx), { year: args.year ?? yearOf(ctx), upcomingOnly: args.upcomingOnly, today: ctx.today }),
    }),
  }),

  defineTool({
    access: "employee",
    declaration: {
      name: "get_my_pay",
      description:
        "The signed-in employee's OWN payslips for a year (base pay, allowances, bonus, gross, tax, deductions, net, pay date) " +
        "and year-to-date totals. It can only return the caller's own pay; nobody else's.",
      parameters: { type: Type.OBJECT, properties: { year: yearParam } },
    },
    args: z.object({ year }),
    run: async (args, ctx) => ({ data: await getMyPay(me(ctx), { year: args.year ?? yearOf(ctx) }) }),
  }),

  defineTool({
    access: "employee",
    declaration: {
      name: "get_my_benefits",
      description:
        "The signed-in employee's own active benefit enrollments (health, dental, vision, life, retirement): plan, provider, " +
        "coverage level, dependents and their monthly cost.",
    },
    args: z.object({}),
    run: async (_args, ctx) => ({ data: await getMyBenefits(me(ctx), { today: ctx.today }) }),
  }),

  defineTool({
    access: "employee",
    declaration: {
      name: "find_colleagues",
      description:
        "Search the company directory by name, job title or department. Returns name, job title, email, department, " +
        "office and manager. Use for 'who is X?', 'who is my HR contact?' or 'who works in Finance?'.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          query: { type: Type.STRING, description: "Name or job title words, e.g. 'arjun' or 'payroll specialist'." },
          department: { type: Type.STRING, description: "Department code or name, e.g. 'ENG' or 'Finance'." },
        },
      },
    },
    args: z.object({ query: z.string().trim().max(100).optional(), department: z.string().trim().max(50).optional() }),
    run: async (args, ctx) => ({ data: await findColleagues(me(ctx), { ...args, limit: 10 }) }),
  }),

  defineTool({
    access: "manager",
    declaration: {
      name: "get_team_leave",
      description:
        "Leave requests of the people the signed-in user manages (managers: their direct reports; HR: everyone) that overlap " +
        "a date range. Default: pending and approved requests from today for 30 days. Use for 'who on my team is off next " +
        "week?'. For 'what leave is waiting for my approval?', set status PENDING and leave the dates empty: that covers " +
        `the next ${MAX_TEAM_RANGE_DAYS} days.`,
      parameters: {
        type: Type.OBJECT,
        properties: {
          from: { type: Type.STRING, description: "Start date, YYYY-MM-DD. Default today." },
          to: { type: Type.STRING, description: `End date, YYYY-MM-DD. Default 30 days after from. At most ${MAX_TEAM_RANGE_DAYS} days after from.` },
          status: statusParam,
          department: { type: Type.STRING, description: "HR only: department code or name." },
        },
      },
    },
    args: z.object({ from: isoDate.optional(), to: isoDate.optional(), status: z.enum(LEAVE_STATUSES).optional(), department: z.string().trim().max(50).optional() }),
    run: async (args, ctx) => {
      const from = args.from ?? ctx.today;
      // "What's waiting for my approval?" means every pending request, not just
      // the next month's, so pending lists look as far ahead as allowed.
      const to = args.to ?? addDays(from, args.status === "PENDING" ? MAX_TEAM_RANGE_DAYS : 30);
      return { data: await getTeamLeave(me(ctx), { ...args, from, to, limit: 50 }) };
    },
  }),
];

const BY_NAME = new Map(TOOLS.map((t) => [t.declaration.name!, t]));

/** May this user use a tool with this access level? */
export function canUse(access: ToolAccess, user: AuthUser | null): boolean {
  if (access === "public") return true;
  if (!user) return false;
  return access === "employee" || user.role === "MANAGER" || user.role === "HR_ADMIN";
}

/** The tools to offer the model for this user. Not signed in = handbook only. */
export function toolDeclarationsFor(user: AuthUser | null): FunctionDeclaration[] {
  return TOOLS.filter((t) => canUse(t.access, user)).map((t) => t.declaration);
}

type Outcome = { call: FunctionCall; output?: ToolOutput; error?: string };

/**
 * Runs the calls the model asked for (in parallel) and returns one response
 * per call, with the call's id so the model can match them up.
 *
 * Handbook passages are numbered after the ones already in `chunks` (which
 * this adds to), so a second search's passages are [4], [5]... and citations
 * stay unique across the whole answer.
 *
 * Errors go back to the model as { error } results, so it can tell the user
 * ("you don't have access to that") instead of the request failing.
 */
export async function executeToolCalls(
  calls: FunctionCall[],
  ctx: ToolContext,
  chunks: RetrievedChunk[],
  log: Logger,
): Promise<FunctionResponse[]> {
  const outcomes = await Promise.all(calls.map((call) => runOne(call, ctx, log)));

  return outcomes.map(({ call, output, error }) => {
    const { id, name } = call;
    if (!output) return { id, name, response: { error } };
    if ("data" in output) return { id, name, response: { result: output.data } };
    const start = chunks.length + 1;
    chunks.push(...output.chunks);
    return { id, name, response: { result: formatContext(output.chunks, start) } };
  });
}

async function runOne(call: FunctionCall, ctx: ToolContext, log: Logger): Promise<Outcome> {
  const tool = call.name ? BY_NAME.get(call.name) : undefined;
  if (!tool) return { call, error: `Unknown tool "${call.name}"` };

  let user = ctx.user;
  if (tool.access !== "public") {
    if (!user) return { call, error: "The user is not signed in, so their HR records can't be looked up." };
    // Fresh from the database: a voice session can outlive a role change or termination.
    const fresh = await findAuthInfo(user.id).catch(() => null);
    if (!fresh || fresh.status === "TERMINATED") return { call, error: "The user's session is no longer valid." };
    user = { id: fresh.id, role: fresh.role };
  }
  if (!canUse(tool.access, user)) {
    log.warn({ tool: call.name, userId: user?.id, role: user?.role }, "Tool call refused: role not allowed");
    return { call, error: "Access denied: the user's role is not allowed to see this information." };
  }

  const args = tool.args.safeParse(call.args ?? {});
  if (!args.success) {
    return { call, error: `Invalid arguments: ${args.error.issues.map((i) => `${i.path.join(".") || "args"} ${i.message}`).join("; ")}` };
  }

  log.info({ tool: call.name, args: args.data, userId: user?.id }, "Tool called");
  try {
    return { call, output: await tool.run(args.data, { ...ctx, user }) };
  } catch (err) {
    // 4xx from a service (forbidden, bad range, not found) is safe and useful to pass on.
    if (err instanceof HttpError && err.status < 500) {
      if (err.status === 403) log.warn({ tool: call.name, userId: user?.id }, "Tool call refused by service");
      return { call, error: err.status === 403 ? `Access denied: ${err.message}` : err.message };
    }
    log.error({ err, tool: call.name }, "Tool failed");
    return {
      call,
      error: call.name === SEARCH_HANDBOOK ? "The handbook search is unavailable right now." : "The HR system is unavailable right now.",
    };
  }
}
