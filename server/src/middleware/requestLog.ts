import type { RequestHandler } from "express";
import { logger } from "../lib/logger.js";

/** Paths polled constantly by monitors and the admin app; logged only at debug level. */
const QUIET_PATHS = new Set(["/health"]);

/**
 * Logs one line per request once the response is sent:
 *   POST /api/v1/chat/ask 200 2310ms
 * Errors (5xx) log as "error", client mistakes (4xx) as "warn", the rest as
 * "info"; health checks as "debug" so they don't drown everything else.
 * Request bodies and headers are never logged: they may contain the admin key.
 */
export const requestLog: RequestHandler = (req, res, next) => {
  const start = process.hrtime.bigint();
  // originalUrl, not path: inside a router, req.path loses the mount prefix
  // ("/documents" instead of "/api/v1/admin/documents").
  const path = req.originalUrl.split("?")[0];

  res.on("finish", () => {
    const ms = Number((process.hrtime.bigint() - start) / 1_000_000n);
    const level =
      res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : QUIET_PATHS.has(path) ? "debug" : "info";
    logger[level]({ status: res.statusCode, ms }, `${req.method} ${path} ${res.statusCode} ${ms}ms`);
  });
  next();
};
