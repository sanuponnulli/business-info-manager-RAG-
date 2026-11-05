import { ApiError } from "@google/genai";
import { logger } from "./logger.js";

export interface RetryOptions {
  /** How many times to retry after the first attempt fails. */
  retries?: number;
  /** Delay before the first retry; doubles each time (500ms, 1s, 2s, ...). */
  baseDelayMs?: number;
  /** Label used in log messages. */
  label?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Errors worth retrying are temporary: rate limits (429), server-side
 * failures (5xx) and network problems. A 400 (bad request) or 403 (bad key)
 * will fail the same way every time, so we give up on those immediately.
 */
export function isRetryable(err: unknown): boolean {
  if (err instanceof ApiError) {
    return err.status === 429 || err.status >= 500;
  }
  // fetch() throws a TypeError when the network itself fails.
  return err instanceof TypeError;
}

/**
 * Runs `fn`, retrying temporary failures with exponential backoff.
 * A little random "jitter" is added so many clients that failed at the same
 * moment don't all retry at the same moment too.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { retries = 4, baseDelayMs = 500, label = "request" } = options;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isRetryable(err)) throw err;
      const delay = baseDelayMs * 2 ** attempt + Math.random() * baseDelayMs;
      logger.warn({ err, attempt: attempt + 1, delayMs: Math.round(delay) }, `${label} failed, retrying`);
      await sleep(delay);
    }
  }
}
