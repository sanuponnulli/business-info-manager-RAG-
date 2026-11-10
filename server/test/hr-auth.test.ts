import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import request from "supertest";
import { SignJWT } from "jose";

// The repository is the only thing that touches Postgres; faking it keeps
// these tests free of Docker. (The real queries are checked in the README's curl steps.)
vi.mock("../src/clients/chroma.js", () => ({ isChromaUp: async () => true }));
vi.mock("../src/repositories/employee.repository.js", () => ({
  refSelect: {},
  findCredentialsByEmail: vi.fn(),
  findAuthInfo: vi.fn(),
  findSummaryById: vi.fn(),
  findMyProfileById: vi.fn(),
}));

import * as employees from "../src/repositories/employee.repository.js";
import { hashPassword } from "../src/lib/password.js";
import { signAccessToken } from "../src/lib/jwt.js";
import { createApp } from "../src/app.js";

const repo = vi.mocked(employees);
const app = createApp();
const login = (body: object) => request(app).post("/api/v1/auth/login").send(body);
const getMe = (token?: string) => {
  const req = request(app).get("/api/v1/me");
  return token ? req.set("Authorization", `Bearer ${token}`) : req;
};

const summary = {
  id: 7,
  employeeCode: "E0007",
  firstName: "Sneha",
  lastName: "Nair",
  email: "employee@acme.test",
  jobTitle: "Flutter Developer",
  department: { id: 2, code: "ENG", name: "Engineering" },
  location: { id: 2, code: "COK", name: "Kochi Office" },
};

let passwordHash: string;
beforeAll(async () => {
  passwordHash = await hashPassword("Password123!");
});

beforeEach(() => {
  vi.resetAllMocks();
  repo.findCredentialsByEmail.mockResolvedValue({ id: 7, passwordHash, status: "ACTIVE" });
  repo.findSummaryById.mockResolvedValue(summary);
  repo.findAuthInfo.mockResolvedValue({ id: 7, role: "EMPLOYEE", status: "ACTIVE" });
});

describe("POST /api/v1/auth/login", () => {
  it("returns a token and the employee for the right password", async () => {
    const res = await login({ email: "Employee@acme.test", password: "Password123!" });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ tokenType: "Bearer", expiresIn: 3600, employee: summary });
    expect(res.body.data.accessToken.split(".")).toHaveLength(3); // header.payload.signature
    expect(repo.findCredentialsByEmail).toHaveBeenCalledWith("employee@acme.test"); // lower-cased
  });

  it("gives the same 401 for a wrong password, an unknown email and a terminated account", async () => {
    const wrongPassword = await login({ email: "employee@acme.test", password: "nope" });

    repo.findCredentialsByEmail.mockResolvedValueOnce(null);
    const unknownEmail = await login({ email: "ghost@acme.test", password: "Password123!" });

    repo.findCredentialsByEmail.mockResolvedValueOnce({ id: 9, passwordHash, status: "TERMINATED" });
    const terminated = await login({ email: "gone@acme.test", password: "Password123!" });

    for (const res of [wrongPassword, unknownEmail, terminated]) {
      expect(res.status).toBe(401);
      expect(res.body.error).toEqual({ code: "invalid_credentials", message: "Wrong email or password" });
    }
  });

  it("rejects a malformed body with invalid_request and per-field details", async () => {
    const res = await login({ email: "not-an-email" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_request");
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(["email", "password"]);
    expect(repo.findCredentialsByEmail).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/me", () => {
  const profileRow = {
    ...summary,
    phone: "+91 98470 00000",
    role: "EMPLOYEE" as const,
    employmentType: "FULL_TIME" as const,
    status: "ACTIVE" as const,
    hireDate: new Date("2023-03-13T00:00:00Z"),
    manager: { id: 3, firstName: "Arjun", lastName: "Menon", jobTitle: "Engineering Manager" },
    _count: { directReports: 0 },
  };

  it("returns the caller's own profile in the contract's shape", async () => {
    repo.findMyProfileById.mockResolvedValue(profileRow);
    const res = await getMe(await signAccessToken(7));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      ...summary,
      phone: "+91 98470 00000",
      role: "EMPLOYEE",
      employmentType: "FULL_TIME",
      status: "ACTIVE",
      hireDate: "2023-03-13",
      manager: { id: 3, name: "Arjun Menon", jobTitle: "Engineering Manager" },
      directReportCount: 0,
    });
    expect(repo.findMyProfileById).toHaveBeenCalledWith(7); // id from the token
  });

  it("401s without a token, with a forged one and with an expired one", async () => {
    const secret = new TextEncoder().encode("test-jwt-secret-0123456789abcdef0123456789");
    const forged = await new SignJWT().setProtectedHeader({ alg: "HS256" }).setSubject("7").setIssuer("acme-hr")
      .setExpirationTime("1h").sign(new TextEncoder().encode("some-other-secret-that-is-long-enough"));
    const expired = await new SignJWT().setProtectedHeader({ alg: "HS256" }).setSubject("7").setIssuer("acme-hr")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200).setExpirationTime(Math.floor(Date.now() / 1000) - 3600).sign(secret);

    for (const res of [await getMe(), await getMe(forged), await getMe(expired), await getMe("garbage")]) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("unauthorized");
    }
    expect(repo.findMyProfileById).not.toHaveBeenCalled();
  });

  it("locks out an employee terminated after their token was issued", async () => {
    const token = await signAccessToken(7);
    repo.findAuthInfo.mockResolvedValue({ id: 7, role: "EMPLOYEE", status: "TERMINATED" });

    expect((await getMe(token)).status).toBe(401);
  });
});
