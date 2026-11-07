import { ApiError } from "@google/genai";
import { logger } from "./logger.js";

export interface RetryOptions {
  /** How many times to retry after the first attempt fails. */
  retries?: number;
  /** Delay before the first retry; doubles each time (500ms, 1s, 2s, ...). */
  baseDelayMs?: number;
  /**
   * Longest we're willing to wait before one retry. If the API asks us to
   * wait longer than this (a rate limit), we give up instead of waiting.
   */
  maxDelayMs?: number;
  /** Label used in log messages. */
  label?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Errors worth retrying are temporary: rate limits (429), server-side
 * failures (5xx), network problems and timeouts. A 400 (bad request) or
 * 403 (bad key) will fail the same way every time, so we give up on those.
 */
export function isRetryable(err: unknown): boolean {
  if (err instanceof ApiError) {
    return err.status === 429 || err.status >= 500;
  }
  // fetch() throws a TypeError when the network itself fails...
  if (err instanceof TypeError) return true;
  // ...and an AbortError/TimeoutError when our per-request timeout fires.
  return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
}

/**
 * How long the API asked us to wait, if it said. Gemini's 429 errors carry
 * it as `"retryDelay": "51s"` and as "Please retry in 51.1s" in the message.
 */
export function serverRetryDelayMs(err: unknown): number | null {
  if (!(err instanceof ApiError) || err.status !== 429) return null;
  const match = err.message.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/) ?? err.message.match(/retry in (\d+(?:\.\d+)?)s/i);
  return match ? Math.ceil(Number(match[1]) * 1000) : null;
}

/**
 * Runs `fn`, retrying temporary failures with exponential backoff.
 * A little random "jitter" is added so many clients that failed at the same
 * moment don't all retry at the same moment too. If the API says how long
 * to wait (rate limits), we wait at least that long.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { retries = 4, baseDelayMs = 500, maxDelayMs = 90_000, label = "request" } = options;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isRetryable(err)) throw err;

      const backoff = baseDelayMs * 2 ** attempt + Math.random() * baseDelayMs;
      const asked = serverRetryDelayMs(err);
      const delay = Math.max(backoff, asked ?? 0);
      if (delay > maxDelayMs) throw err; // waiting that long isn't worth it here

      logger.warn(
        { status: err instanceof ApiError ? err.status : err instanceof Error ? err.name : undefined, attempt: attempt + 1, delayMs: Math.round(delay) },
        `${label} failed, retrying in ${(delay / 1000).toFixed(1)}s`,
      );
      await sleep(delay);
    }
  }
}
