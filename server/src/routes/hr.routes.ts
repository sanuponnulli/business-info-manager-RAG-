import { Router } from "express";
import * as auth from "../controllers/auth.controller.js";
import * as me from "../controllers/me.controller.js";
import { requireUser } from "../middleware/userAuth.js";

/**
 * The HR API (contract: docs/hr-openapi.yaml). Mounted at /api/v1 in app.ts.
 *
 * Request flow:  route → middleware (auth) → controller (HTTP in/out)
 *                → service (rules) → repository (Prisma) → Postgres
 */
export const hrRouter = Router();

// Public: the only HR route that works without a token.
hrRouter.post("/auth/login", auth.login);

// Everything below needs `Authorization: Bearer <token>`.
// Scoped to these paths (not hrRouter.use(requireUser)), so it never catches
// other routers' requests that pass through /api/v1.
hrRouter.get("/me", requireUser, me.getMe);
