import type { z } from "zod";
import { HttpError } from "./httpError.js";

/**
 * Parses `input` with a zod schema, or throws a 400 that lists every problem:
 *   { "error": { "code": "invalid_request", "message": "email: Invalid email",
 *                "details": [{ "path": "email", "message": "Invalid email" }] } }
 * Use it for bodies, query strings and path params alike.
 */
export function validate<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  const details = result.error.issues.map((issue) => ({
    path: issue.path.join(".") || "(root)",
    message: issue.message,
  }));
  const message = details.map((d) => `${d.path}: ${d.message}`).join("; ");
  throw new HttpError(400, "invalid_request", message, details);
}
