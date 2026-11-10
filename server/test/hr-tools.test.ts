import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { pino } from "pino";
import type { FunctionCall } from "@google/genai";

// Fake every repository: these tests check WHO may run WHAT and which
// filters reach the database, without needing Postgres.
vi.mock("../src/clients/chroma.js", () => ({ isChromaUp: async () => true }));
vi.mock("../src/clients/gemini.js", () => ({ gemini: { models: { generateContent: vi.fn() } } }));
vi.mock("../src/services/rag.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/services/rag.service.js")>()),
  retrieveContext: vi.fn(async () => ({ chunks: [], contextText: "" })),
}));
vi.mock("../src/repositories/employee.repository.js", () => ({
  refSelect: {},
  findAuthInfo: vi.fn(),
  findMyProfileById: vi.fn(),
  searchEmployees: vi.fn(async () => ({ rows: [], total: 0 })),
  findLocationOf: vi.fn(),
}));
vi.mock("../src/repositories/leave.repository.js", () => ({
  findBalances: vi.fn(async () => []),
  pendingDaysByType: vi.fn(async () => new Map()),
  findRequests: vi.fn(async () => ({ rows: [], total: 0 })),
}));
vi.mock("../src/repositories/pay.repository.js", () => ({ findPayslips: vi.fn(async () => []) }));

import * as employees from "../src/repositories/employee.repository.js";
import * as leave from "../src/repositories/leave.repository.js";
import * as pay from "../src/repositories/pay.repository.js";
import { gemini } from "../src/clients/gemini.js";
import { signAccessToken } from "../src/lib/jwt.js";
import { createApp } from "../src/app.js";
import { executeToolCalls, toolDeclarationsFor, type ToolContext } from "../src/tools/registry.js";
import type { AuthUser } from "../src/middleware/userAuth.js";

const log = pino({ level: "silent" });
const repo = { employees: vi.mocked(employees), leave: vi.mocked(leave), pay: vi.mocked(pay) };

const EMPLOYEE: AuthUser = { id: 11, role: "EMPLOYEE" };
const MANAGER: AuthUser = { id: 6, role: "MANAGER" };
const HR: AuthUser = { id: 3, role: "HR_ADMIN" };
const ctx = (user: AuthUser | null): ToolContext => ({ user, today: "2026-11-09" });

/** Runs one tool call as `user` and returns what the model would get back. */
async function call(user: AuthUser | null, name: string, args: Record<string, unknown> = {}) {
  const [response] = await executeToolCalls([{ id: "c", name, args } as FunctionCall], ctx(user), [], log);
  return response.response as { result?: any; error?: string };
}

beforeEach(() => {
  vi.clearAllMocks();
  // The database agrees with whatever role the caller claims, unless a test says otherwise.
  repo.employees.findAuthInfo.mockImplementation(async (id) => {
    const user = [EMPLOYEE, MANAGER, HR].find((u) => u.id === id);
    return user ? { ...user, status: "ACTIVE" as const } : null;
  });
});

const names = (user: AuthUser | null) => toolDeclarationsFor(user).map((d) => d.name);

describe("which tools the model is offered", () => {
  it("not signed in: the handbook only", () => {
    expect(names(null)).toEqual(["search_handbook"]);
  });

  it("employee: own records and the directory, but not team leave", () => {
    expect(names(EMPLOYEE)).toEqual(expect.arrayContaining(["search_handbook", "get_my_leave_balances", "get_my_pay", "find_colleagues"]));
    expect(names(EMPLOYEE)).not.toContain("get_team_leave");
  });

  it("manager and HR: team leave as well", () => {
    expect(names(MANAGER)).toContain("get_team_leave");
    expect(names(HR)).toContain("get_team_leave");
  });

  it("no tool takes an employee id: identity only ever comes from the token", () => {
    for (const declaration of toolDeclarationsFor(HR)) {
      const params = Object.keys(declaration.parameters?.properties ?? {});
      expect(params.filter((p) => /employee|user|id$/i.test(p))).toEqual([]);
    }
  });
});

describe("refusing calls the role doesn't allow", () => {
  it("an employee calling get_team_leave (never offered) is refused before the database", async () => {
    const res = await call(EMPLOYEE, "get_team_leave");
    expect(res.error).toMatch(/Access denied/);
    expect(repo.leave.findRequests).not.toHaveBeenCalled();
  });

  it("an anonymous caller can't reach personal records", async () => {
    const res = await call(null, "get_my_pay");
    expect(res.error).toMatch(/not signed in/);
    expect(repo.pay.findPayslips).not.toHaveBeenCalled();
  });

  it("uses the role in the database, not the one the session started with (demoted manager)", async () => {
    repo.employees.findAuthInfo.mockResolvedValueOnce({ id: 6, role: "EMPLOYEE", status: "ACTIVE" });
    const res = await call(MANAGER, "get_team_leave");
    expect(res.error).toMatch(/Access denied/);
    expect(repo.leave.findRequests).not.toHaveBeenCalled();
  });

  it("locks out someone terminated mid-session", async () => {
    repo.employees.findAuthInfo.mockResolvedValueOnce({ id: 11, role: "EMPLOYEE", status: "TERMINATED" });
    expect((await call(EMPLOYEE, "get_my_leave_balances")).error).toMatch(/no longer valid/);
    expect(repo.leave.findBalances).not.toHaveBeenCalled();
  });
});

describe("scoping the database queries", () => {
  it("get_my_pay reads the caller's own payslips, even if the model slips in someone else's id", async () => {
    await call(EMPLOYEE, "get_my_pay", { year: 2026, employeeId: 6 });
    expect(repo.pay.findPayslips).toHaveBeenCalledWith(11, 2026);
  });

  it("a manager's team leave is filtered to their direct reports", async () => {
    await call(MANAGER, "get_team_leave", { from: "2026-11-09", to: "2026-11-30" });
    const where = repo.leave.findRequests.mock.calls[0][0];
    expect(where.employee).toEqual({ managerId: 6 });
  });

  it("HR's team leave covers everyone", async () => {
    await call(HR, "get_team_leave");
    expect(repo.leave.findRequests.mock.calls[0][0].employee).toEqual({});
  });

  it("a non-HR directory search never includes terminated employees", async () => {
    await call(EMPLOYEE, "find_colleagues", { query: "arjun" });
    const where = repo.employees.searchEmployees.mock.calls[0][0] as { AND: unknown[] };
    expect(where.AND[0]).toEqual({ status: { not: "TERMINATED" } });
  });

  it("hire date and status are shown only to HR and the person's own manager", async () => {
    const row = {
      id: 20, firstName: "Ravi", lastName: "K", jobTitle: "Engineer", email: "ravi@acme.test", managerId: 6,
      hireDate: new Date("2024-01-01T00:00:00Z"), employmentType: "FULL_TIME" as const, status: "ON_LEAVE" as const,
      department: { name: "Engineering" }, location: { name: "Kochi Office" }, manager: null,
    };
    repo.employees.searchEmployees.mockResolvedValue({ rows: [row], total: 1 });

    const asColleague = (await call(EMPLOYEE, "find_colleagues", { query: "ravi" })).result.employees[0];
    const asManager = (await call(MANAGER, "find_colleagues", { query: "ravi" })).result.employees[0];

    expect(asColleague).not.toHaveProperty("status");
    expect(asColleague).not.toHaveProperty("hireDate");
    expect(asManager).toMatchObject({ status: "ON_LEAVE", hireDate: "2024-01-01" });
  });

  it("rejects bad arguments from the model instead of querying with them", async () => {
    const res = await call(MANAGER, "get_team_leave", { from: "next tuesday" });
    expect(res.error).toMatch(/Invalid arguments: from/);
    expect(repo.leave.findRequests).not.toHaveBeenCalled();
  });

  it("caps get_team_leave at 92 days so one call can't dump a year of everyone's leave", async () => {
    const res = await call(HR, "get_team_leave", { from: "2026-01-01", to: "2026-12-31" });
    expect(res.error).toMatch(/at most 92 days/);
  });
});

describe("POST /api/v1/chat/ask with sign-in", () => {
  const app = createApp();
  const generateContent = vi.mocked(gemini.models.generateContent);
  const toolNamesSent = () => generateContent.mock.calls[0][0].config?.tools?.[0].functionDeclarations?.map((d) => d.name);

  beforeEach(() => generateContent.mockResolvedValue({ text: "Hello!" } as never));

  it("offers a signed-in manager the HR tools", async () => {
    const res = await request(app)
      .post("/api/v1/chat/ask")
      .set("Authorization", `Bearer ${await signAccessToken(6)}`)
      .send({ question: "hi" });
    expect(res.status).toBe(200);
    expect(toolNamesSent()).toContain("get_team_leave");
    expect(generateContent.mock.calls[0][0].config?.systemInstruction).toMatch(/manager/);
  });

  it("still works without a token, handbook only", async () => {
    const res = await request(app).post("/api/v1/chat/ask").send({ question: "hi" });
    expect(res.status).toBe(200);
    expect(toolNamesSent()).toEqual(["search_handbook"]);
  });

  it("401s a bad token rather than quietly answering as anonymous", async () => {
    const res = await request(app).post("/api/v1/chat/ask").set("Authorization", "Bearer nonsense").send({ question: "hi" });
    expect(res.status).toBe(401);
    expect(generateContent).not.toHaveBeenCalled();
  });
});

describe("get_team_leave defaults", () => {
  it("looks 92 days ahead for pending approvals, 30 days otherwise", async () => {
    await call(MANAGER, "get_team_leave", { status: "PENDING" });
    await call(MANAGER, "get_team_leave");
    const [pending, absences] = repo.leave.findRequests.mock.calls.map(([where]) => where.startDate);
    expect(pending).toEqual({ lte: new Date("2027-02-09T00:00:00Z") });
    expect(absences).toEqual({ lte: new Date("2026-12-09T00:00:00Z") });
  });
});
