import type { RequestHandler } from "express";
import { logger } from "../lib/logger.js";

/**
 * Logs one line per request once the response is sent:
 *   POST /api/v1/chat/ask 200 2310ms
 * Errors (5xx) log as "error", client mistakes (4xx) as "warn", the rest as "info".
 * Request bodies and headers are never logged: they may contain the admin key.
 */
export const requestLog: RequestHandler = (req, res, next) => {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const ms = Number((process.hrtime.bigint() - start) / 1_000_000n);
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    logger[level]({ method: req.method, path: req.path, status: res.statusCode, ms }, `${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
  });
  next();
};
