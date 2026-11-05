import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApiError } from "@google/genai";

// Replace the real Gemini client with a fake whose embedContent we control.
vi.mock("../src/clients/gemini.js", () => ({
  gemini: { models: { embedContent: vi.fn() } },
}));

import { gemini } from "../src/clients/gemini.js";
import { embedDocuments, embedQuery, EMBEDDING_DIMENSIONS } from "../src/services/embedding.service.js";

const embedContent = vi.mocked(gemini.models.embedContent);

/** Fake response: one vector of the right size per input text. */
function fakeResponse(count: number) {
  return { embeddings: Array.from({ length: count }, () => ({ values: new Array(EMBEDDING_DIMENSIONS).fill(0.1) })) };
}

beforeEach(() => {
  embedContent.mockReset();
  // Make embedContent echo back as many vectors as texts it was given.
  embedContent.mockImplementation(async ({ contents }) => fakeResponse((contents as string[]).length) as never);
});

describe("embedDocuments", () => {
  it("splits 250 texts into batches of 100, 100 and 50, keeping order", async () => {
    const texts = Array.from({ length: 250 }, (_, i) => `chunk ${i}`);
    const vectors = await embedDocuments(texts, "Handbook");

    expect(embedContent).toHaveBeenCalledTimes(3);
    const batchSizes = embedContent.mock.calls.map(([args]) => (args.contents as string[]).length);
    expect(batchSizes).toEqual([100, 100, 50]);
    expect(vectors).toHaveLength(250);

    const firstCall = embedContent.mock.calls[0][0];
    expect(firstCall.config).toMatchObject({ taskType: "RETRIEVAL_DOCUMENT", title: "Handbook" });
  });

  it("rejects a vector of the wrong size", async () => {
    embedContent.mockResolvedValueOnce({ embeddings: [{ values: [1, 2, 3] }] } as never);
    await expect(embedDocuments(["x"])).rejects.toThrow(/3072-d/);
  });
});

describe("embedQuery", () => {
  it("uses RETRIEVAL_QUERY and sends no title", async () => {
    const vector = await embedQuery("how many holidays?");
    expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
    const config = embedContent.mock.calls[0][0].config!;
    expect(config.taskType).toBe("RETRIEVAL_QUERY");
    expect(config).not.toHaveProperty("title");
  });
});

describe("retries", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("retries a 429 rate limit and then succeeds", async () => {
    embedContent.mockRejectedValueOnce(new ApiError({ message: "rate limited", status: 429 }));
    const promise = embedQuery("hello");
    await vi.runAllTimersAsync(); // skip the backoff wait instantly
    await expect(promise).resolves.toHaveLength(EMBEDDING_DIMENSIONS);
    expect(embedContent).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 400 bad request", async () => {
    embedContent.mockRejectedValueOnce(new ApiError({ message: "bad request", status: 400 }));
    await expect(embedQuery("hello")).rejects.toThrow("bad request");
    expect(embedContent).toHaveBeenCalledTimes(1);
  });
});
