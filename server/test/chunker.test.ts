import { describe, it, expect } from "vitest";
import { chunkPages, CHUNK_SIZE } from "../src/ingestion/chunker.js";
import { cleanText } from "../src/ingestion/pdf.js";

/** A page of ~5000 characters made of numbered sentences we can track. */
const longPage = Array.from({ length: 100 }, (_, i) => `Sentence number ${i} of the policy text.`).join(" ");

describe("chunkPages", () => {
  it("keeps every chunk within the size limit", async () => {
    const chunks = await chunkPages([{ page: 1, text: longPage }]);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(CHUNK_SIZE);
  });

  it("overlaps neighbouring chunks", async () => {
    const [a, b] = await chunkPages([{ page: 1, text: longPage }]);
    // The first words of chunk b should appear near the end of chunk a.
    const startOfB = b.text.slice(0, 40);
    expect(a.text).toContain(startOfB);
  });

  it("loses no text: every sentence lands in some chunk", async () => {
    const chunks = await chunkPages([{ page: 1, text: longPage }]);
    const all = chunks.map((c) => c.text).join(" ");
    for (let i = 0; i < 100; i++) expect(all).toContain(`Sentence number ${i} `);
  });

  it("tags chunks with their page and numbers them across the document", async () => {
    const chunks = await chunkPages([
      { page: 1, text: "Short page one." },
      { page: 3, text: longPage },
    ]);
    expect(chunks[0]).toEqual({ text: "Short page one.", page: 1, chunkIndex: 0 });
    expect(chunks.slice(1).every((c) => c.page === 3)).toBe(true);
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
  });

  it("returns no chunks for no pages", async () => {
    expect(await chunkPages([])).toEqual([]);
  });
});

describe("cleanText", () => {
  it("collapses spaces and blank lines but keeps single line breaks", () => {
    const raw = "Leave   Policy  \r\n\r\n\r\n\r\n  Employees\tget   25 days.\nSee HR.";
    expect(cleanText(raw)).toBe("Leave Policy\n\nEmployees get 25 days.\nSee HR.");
  });
});
