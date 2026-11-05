import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { env } from "../config/env.js";
import { HttpError } from "../lib/httpError.js";

const sha256 = (value: string) => createHash("sha256").update(value).digest();
const expected = sha256(env.ADMIN_API_KEY);

/**
 * Lets a request through only if its `x-admin-key` header matches ADMIN_API_KEY.
 *
 * Why not just `header === key`? A normal string comparison stops at the
 * first wrong character, so a wrong key that starts correctly takes a tiny
 * bit longer to reject. An attacker can measure that and guess the key one
 * character at a time. timingSafeEqual always takes the same time.
 * Hashing both sides first gives equal-length inputs, which it requires.
 */
export const adminAuth: RequestHandler = (req, _res, next) => {
  const provided = req.header("x-admin-key");
  if (!provided || !timingSafeEqual(sha256(provided), expected)) {
    throw new HttpError(401, "unauthorized", "Missing or invalid x-admin-key header");
  }
  next();
};
