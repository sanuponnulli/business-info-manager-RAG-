import { describe, it, expect, vi, beforeEach } from "vitest";

const collection = { query: vi.fn() };
vi.mock("../src/clients/chroma.js", () => ({ getCollection: async () => collection }));
vi.mock("../src/services/embedding.service.js", () => ({ embedQuery: vi.fn(async () => [0.1, 0.2, 0.3]) }));

import { embedQuery } from "../src/services/embedding.service.js";
import { retrieveContext, formatContext } from "../src/services/rag.service.js";

/** Shape Chroma returns for one query: every field is a list of lists. */
const chromaResult = {
  documents: [["Ten days of paid sick leave.", "Notify your manager before 9am."]],
  metadatas: [[
    { docId: "handbook", title: "Handbook", page: 2, chunkIndex: 2 },
    { docId: "handbook", title: "Handbook", page: 2, chunkIndex: 3 },
  ]],
  distances: [[0.25, 0.4]],
};

beforeEach(() => {
  vi.clearAllMocks();
  collection.query.mockResolvedValue(chromaResult);
});

describe("retrieveContext", () => {
  it("embeds the question as a query and asks Chroma for the top 3", async () => {
    await retrieveContext("  sick days?  ");
    expect(embedQuery).toHaveBeenCalledWith("sick days?");
    expect(collection.query).toHaveBeenCalledWith(expect.objectContaining({ queryEmbeddings: [[0.1, 0.2, 0.3]], nResults: 3 }));
  });

  it("passes a custom k through", async () => {
    await retrieveContext("sick days?", 5);
    expect(collection.query).toHaveBeenCalledWith(expect.objectContaining({ nResults: 5 }));
  });

  it("turns distances into scores and keeps metadata", async () => {
    const { chunks } = await retrieveContext("sick days?");
    expect(chunks).toEqual([
      { text: "Ten days of paid sick leave.", docId: "handbook", title: "Handbook", page: 2, score: 0.75 },
      { text: "Notify your manager before 9am.", docId: "handbook", title: "Handbook", page: 2, score: 0.6 },
    ]);
  });

  it("builds numbered context text", async () => {
    const { contextText } = await retrieveContext("sick days?");
    expect(contextText).toBe(
      "[1] (Handbook, p. 2)\nTen days of paid sick leave.\n\n[2] (Handbook, p. 2)\nNotify your manager before 9am.",
    );
  });

  it("handles an empty collection", async () => {
    collection.query.mockResolvedValueOnce({ documents: [[]], metadatas: [[]], distances: [[]] });
    const { chunks, contextText } = await retrieveContext("anything");
    expect(chunks).toEqual([]);
    expect(contextText).toBe("No relevant handbook content was found.");
  });

  it("rejects a blank question without calling Gemini", async () => {
    await expect(retrieveContext("   ")).rejects.toThrow(/empty/);
    expect(embedQuery).not.toHaveBeenCalled();
  });
});

describe("formatContext", () => {
  it("says so when nothing was found", () => {
    expect(formatContext([])).toMatch(/No relevant/);
  });
});
