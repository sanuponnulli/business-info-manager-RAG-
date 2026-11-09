import type { Request, RequestHandler } from "express";
import type { Role } from "../generated/prisma/client.js";
import { HttpError } from "../lib/httpError.js";
import { verifyAccessToken } from "../lib/jwt.js";
import { findAuthInfo } from "../repositories/employee.repository.js";

/** Who is calling. Set by requireUser; read it with currentUser(req). */
export interface AuthUser {
  id: number;
  role: Role;
}

// Adds `user` to Express's Request type, so req.user type-checks everywhere.
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const unauthorized = () => new HttpError(401, "unauthorized", "Missing, invalid or expired access token");

/**
 * Lets a request through only with a valid `Authorization: Bearer <token>`
 * header, and records who the caller is on req.user.
 *
 * The role and status are read from the database on every request, not from
 * the token: a token stays valid for an hour, and someone terminated or
 * demoted in that hour should lose access straight away.
 */
export const requireUser: RequestHandler = async (req, _res, next) => {
  const [scheme, token] = req.header("authorization")?.split(" ") ?? [];
  if (scheme?.toLowerCase() !== "bearer" || !token) throw unauthorized();

  const employeeId = await verifyAccessToken(token);
  if (!employeeId) throw unauthorized();

  const employee = await findAuthInfo(employeeId);
  if (!employee || employee.status === "TERMINATED") throw unauthorized();

  req.user = { id: employee.id, role: employee.role };
  next();
};

/** Use after requireUser: only these roles get through (403 for everyone else). */
export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw new HttpError(403, "forbidden", "You don't have permission to do this");
    }
    next();
  };

/** The signed-in caller. Only valid on routes behind requireUser. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
