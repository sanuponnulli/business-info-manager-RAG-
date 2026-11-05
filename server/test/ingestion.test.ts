import { describe, it, expect, vi, beforeEach } from "vitest";

// Fake every outside dependency so we test only the ingestion logic.
const collection = {
  add: vi.fn(),
  delete: vi.fn(),
  get: vi.fn(),
};
vi.mock("../src/clients/chroma.js", () => ({ getCollection: async () => collection }));
vi.mock("../src/ingestion/pdf.js", () => ({
  extractPages: vi.fn(async () => [
    { page: 1, text: "Leave policy." },
    { page: 2, text: "Sick policy." },
  ]),
}));
vi.mock("../src/services/embedding.service.js", () => ({
  embedDocuments: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2])),
}));

import { embedDocuments } from "../src/services/embedding.service.js";
import { enqueue, getJob, ingestDocument, listDocuments, deleteDocument } from "../src/services/ingestion.service.js";

const pdf = Buffer.from("fake pdf");

/** Waits until the job is finished (the worker runs in the background). */
async function waitForJob(id: string) {
  await vi.waitFor(() => expect(getJob(id)?.finishedAt).toBeDefined());
  return getJob(id)!;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ingestDocument", () => {
  it("stores each chunk with a predictable id and its metadata", async () => {
    const count = await ingestDocument(pdf, "handbook", "Handbook");

    expect(count).toBe(2);
    const { ids, documents, embeddings, metadatas } = collection.add.mock.calls[0][0];
    expect(ids).toEqual(["handbook::0", "handbook::1"]);
    expect(documents).toEqual(["Leave policy.", "Sick policy."]);
    expect(embeddings).toHaveLength(2);
    expect(metadatas[1]).toMatchObject({ docId: "handbook", title: "Handbook", page: 2, chunkIndex: 1 });
  });

  it("deletes the old version only after embedding succeeds", async () => {
    const order: string[] = [];
    vi.mocked(embedDocuments).mockImplementationOnce(async (texts) => {
      order.push("embed");
      return texts.map(() => [0.1]);
    });
    collection.delete.mockImplementationOnce(async () => void order.push("delete"));
    collection.add.mockImplementationOnce(async () => void order.push("add"));

    await ingestDocument(pdf, "handbook", "Handbook");
    expect(order).toEqual(["embed", "delete", "add"]);
    expect(collection.delete).toHaveBeenCalledWith({ where: { docId: "handbook" } });
  });

  it("leaves the old version untouched if embedding fails", async () => {
    vi.mocked(embedDocuments).mockRejectedValueOnce(new Error("Gemini down"));
    await expect(ingestDocument(pdf, "handbook", "Handbook")).rejects.toThrow("Gemini down");
    expect(collection.delete).not.toHaveBeenCalled();
    expect(collection.add).not.toHaveBeenCalled();
  });
});

describe("job queue", () => {
  it("returns a queued job immediately and finishes it in the background", async () => {
    const job = enqueue({ pdf, docId: "handbook", title: "Handbook" });
    expect(job.status).toBe("queued");

    const done = await waitForJob(job.id);
    expect(done).toMatchObject({ status: "done", chunks: 2 });
  });

  it("records the error when a job fails", async () => {
    vi.mocked(embedDocuments).mockRejectedValueOnce(new Error("quota exceeded"));
    const job = enqueue({ pdf, docId: "handbook", title: "Handbook" });

    const failed = await waitForJob(job.id);
    expect(failed).toMatchObject({ status: "failed", error: "quota exceeded" });
  });

  it("runs jobs one at a time", async () => {
    let running = 0;
    let maxRunning = 0;
    vi.mocked(embedDocuments).mockImplementation(async (texts) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 10));
      running--;
      return texts.map(() => [0.1]);
    });

    const jobs = [1, 2, 3].map((n) => enqueue({ pdf, docId: `doc-${n}`, title: `Doc ${n}` }));
    for (const j of jobs) await waitForJob(j.id);
    expect(maxRunning).toBe(1);
  });
});

describe("listDocuments / deleteDocument", () => {
  it("groups chunks into documents", async () => {
    collection.get.mockResolvedValueOnce({
      metadatas: [
        { docId: "b", title: "Benefits", uploadedAt: "t1" },
        { docId: "a", title: "Annual leave", uploadedAt: "t2" },
        { docId: "b", title: "Benefits", uploadedAt: "t1" },
      ],
    });
    expect(await listDocuments()).toEqual([
      { docId: "a", title: "Annual leave", chunks: 1, uploadedAt: "t2" },
      { docId: "b", title: "Benefits", chunks: 2, uploadedAt: "t1" },
    ]);
  });

  it("reports how many chunks were deleted", async () => {
    collection.get.mockResolvedValueOnce({ ids: ["x::0", "x::1", "x::2"] });
    expect(await deleteDocument("x")).toBe(3);
    expect(collection.delete).toHaveBeenCalledWith({ where: { docId: "x" } });
  });
});
