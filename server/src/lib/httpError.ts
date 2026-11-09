/** One problem with a request field, e.g. { path: "startDate", message: "must be a date" }. */
export interface ErrorDetail {
  path: string;
  message: string;
}

/**
 * An error that knows which HTTP response it should become.
 * Throw it anywhere in a route and the error middleware turns it into
 *   { "error": { "code": "...", "message": "...", "details"?: [...] } }  with the given status.
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: ErrorDetail[],
  ) {
    super(message);
    this.name = "HttpError";
  }
}
