import { pino } from "pino";
import { env } from "../config/env.js";

/**
 * One shared logger. In development the output is pretty-printed;
 * in production it is plain JSON (one line per log), which log tools can parse.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  transport:
    env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } }
      : undefined,
});
