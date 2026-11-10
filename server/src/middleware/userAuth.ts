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
 * Turns an access token into the user it belongs to, or null if the token is
 * forged, expired, or belongs to someone who may no longer sign in.
 *
 * The role and status are read from the database every time, not from the
 * token: a token stays valid for an hour, and someone terminated or demoted
 * in that hour should lose access straight away.
 */
export async function resolveUser(token: string): Promise<AuthUser | null> {
  const employeeId = await verifyAccessToken(token);
  if (!employeeId) return null;
  const employee = await findAuthInfo(employeeId);
  if (!employee || employee.status === "TERMINATED") return null;
  return { id: employee.id, role: employee.role };
}

/** The token from an `Authorization: Bearer <token>` header; undefined if there's no such header. */
function bearerToken(req: Request): string | undefined {
  const header = req.header("authorization");
  if (header === undefined) return undefined;
  const [scheme, token] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : "";
}

/** Lets a request through only with a valid bearer token, and records who the caller is on req.user. */
export const requireUser: RequestHandler = async (req, _res, next) => {
  const token = bearerToken(req);
  const user = token ? await resolveUser(token) : null;
  if (!user) throw unauthorized();
  req.user = user;
  next();
};

/**
 * For routes that work both signed in and anonymously (chat: the handbook is
 * public, HR records aren't). No Authorization header → anonymous. A header
 * with a bad or expired token → 401, so the app finds out its token expired
 * instead of silently getting handbook-only answers.
 */
export const optionalUser: RequestHandler = async (req, _res, next) => {
  const token = bearerToken(req);
  if (token === undefined) return next();
  const user = token ? await resolveUser(token) : null;
  if (!user) throw unauthorized();
  req.user = user;
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
