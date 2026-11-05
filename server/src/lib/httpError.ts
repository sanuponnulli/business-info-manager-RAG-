/**
 * An error that knows which HTTP response it should become.
 * Throw it anywhere in a route and the error middleware turns it into
 *   { "error": { "code": "...", "message": "..." } }  with the given status.
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}
