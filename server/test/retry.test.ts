import { describe, it, expect, vi, afterEach } from "vitest";
import { ApiError } from "@google/genai";
import { isRetryable, serverRetryDelayMs, withRetry } from "../src/lib/retry.js";

/** A 429 shaped like the one Gemini's free tier returns. */
const rateLimited = (seconds: number) =>
  new ApiError({
    status: 429,
    message: JSON.stringify({
      error: {
        code: 429,
        message: `Quota exceeded ... Please retry in ${seconds}.101137576s.`,
        details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: `${seconds}s` }],
      },
    }),
  });

afterEach(() => vi.useRealTimers());

describe("isRetryable", () => {
  it("retries temporary problems", () => {
    expect(isRetryable(new ApiError({ message: "", status: 429 }))).toBe(true);
    expect(isRetryable(new ApiError({ message: "", status: 503 }))).toBe(true);
    expect(isRetryable(new TypeError("fetch failed"))).toBe(true);
    expect(isRetryable(new DOMException("aborted", "AbortError"))).toBe(true);
  });

  it("does not retry permanent problems", () => {
    expect(isRetryable(new ApiError({ message: "", status: 400 }))).toBe(false);
    expect(isRetryable(new ApiError({ message: "", status: 403 }))).toBe(false);
    expect(isRetryable(new Error("bug"))).toBe(false);
  });
});

describe("serverRetryDelayMs", () => {
  it("reads Gemini's retryDelay from a 429", () => {
    expect(serverRetryDelayMs(rateLimited(51))).toBe(51_000);
  });

  it("is null for other errors", () => {
    expect(serverRetryDelayMs(new ApiError({ message: "x", status: 503 }))).toBeNull();
  });
});

describe("withRetry", () => {
  it("waits as long as the API asks before retrying a rate limit", async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValueOnce(rateLimited(51)).mockResolvedValueOnce("ok");

    const pending = withRetry(fn, { retries: 3 });
    await vi.advanceTimersByTimeAsync(50_000);
    expect(fn).toHaveBeenCalledTimes(1); // still waiting: our own backoff alone would have retried by now
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(pending).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("gives up straight away if the requested wait is longer than maxDelayMs", async () => {
    const fn = vi.fn().mockRejectedValue(rateLimited(51));
    await expect(withRetry(fn, { retries: 3, maxDelayMs: 5_000 })).rejects.toBeInstanceOf(ApiError);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
