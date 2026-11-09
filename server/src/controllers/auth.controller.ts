import type { RequestHandler } from "express";
import { z } from "zod";
import { validate } from "../lib/validate.js";
import * as auth from "../services/auth.service.js";

/**
 * Controllers are thin: read and validate the HTTP input, call one service,
 * send the result. No database access and no business rules here.
 */

const LoginBody = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(200), // a cap keeps a huge "password" from tying up scrypt
});

/** POST /api/v1/auth/login  { email, password } → { data: { accessToken, tokenType, expiresIn, employee } } */
export const login: RequestHandler = async (req, res) => {
  const { email, password } = validate(LoginBody, req.body);
  res.json({ data: await auth.login(email, password) });
};
