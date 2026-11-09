import { env } from "../config/env.js";
import { HttpError } from "../lib/httpError.js";
import { signAccessToken } from "../lib/jwt.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { toEmployeeSummary } from "../mappers/employee.mapper.js";
import * as employees from "../repositories/employee.repository.js";

// Same message for every failure, so the response doesn't reveal which emails exist.
const invalidLogin = () => new HttpError(401, "invalid_credentials", "Wrong email or password");

// Checked against when the email doesn't exist, so a wrong email takes as
// long as a wrong password. Otherwise the response time reveals which emails exist.
let dummyHash: Promise<string> | undefined;

/** POST /auth/login: email + password → access token and who signed in. */
export async function login(email: string, password: string) {
  const account = await employees.findCredentialsByEmail(email.toLowerCase());
  if (!account) {
    await verifyPassword(password, await (dummyHash ??= hashPassword("not-a-real-password")));
    throw invalidLogin();
  }
  if (!(await verifyPassword(password, account.passwordHash))) throw invalidLogin();
  // Checked after the password, so a terminated account looks like any wrong login.
  if (account.status === "TERMINATED") throw invalidLogin();

  const summary = await employees.findSummaryById(account.id);
  if (!summary) throw invalidLogin(); // deleted in between: vanishingly rare

  return {
    accessToken: await signAccessToken(account.id),
    tokenType: "Bearer" as const,
    expiresIn: env.JWT_TTL_SECONDS,
    employee: toEmployeeSummary(summary),
  };
}
