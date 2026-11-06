import type { ErrorRequestHandler, RequestHandler } from "express";
import multer from "multer";
import { HttpError } from "../lib/httpError.js";
import { logger } from "../lib/logger.js";

/** Any request that matched no route ends up here. */
export const notFound: RequestHandler = (req, _res, next) => {
  next(new HttpError(404, "not_found", `No route for ${req.method} ${req.path}`));
};

/**
 * The single place where errors become HTTP responses. Express calls this
 * whenever a route throws (or calls next(err)), so routes never have to
 * build error responses themselves and every error has the same shape.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const { status, code, message } = toHttpError(err);
  if (status >= 500) logger.error({ err }, "Unhandled error");
  res.status(status).json({ error: { code, message } });
};

function toHttpError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;

  // Upload problems reported by multer (file too big, wrong field name, ...).
  if (err instanceof multer.MulterError) {
    return err.code === "LIMIT_FILE_SIZE"
      ? new HttpError(413, "file_too_large", "The file is larger than the 20 MB limit")
      : new HttpError(400, "bad_upload", err.message);
  }

  // Problems with the JSON body, reported by express.json().
  if (typeof err === "object" && err !== null && "type" in err) {
    if (err.type === "entity.parse.failed") return new HttpError(400, "invalid_json", "Request body is not valid JSON");
    if (err.type === "entity.too.large") return new HttpError(413, "body_too_large", "Request body is larger than 100 KB");
  }

  // Anything else is a bug or an outage. Don't leak internal details to the client.
  return new HttpError(500, "internal_error", "Something went wrong");
}
