import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// The HTTP layer is tested on its own: the ingestion service and Chroma are fakes.
vi.mock("../src/clients/chroma.js", () => ({ isChromaUp: async () => true }));
vi.mock("../src/services/ingestion.service.js", () => ({
  enqueue: vi.fn((input) => ({ id: "job-1", docId: input.docId, title: input.title, status: "queued" })),
  getJob: vi.fn(),
  listDocuments: vi.fn(async () => [{ docId: "handbook", title: "Handbook", chunks: 6, uploadedAt: "t" }]),
  deleteDocument: vi.fn(),
}));

import * as ingestion from "../src/services/ingestion.service.js";
import { createApp } from "../src/app.js";

const app = createApp();
const KEY = "test-admin-key-0123456789"; // matches vitest.config.ts
const pdfBytes = Buffer.from("%PDF-1.4\nfake pdf body");

beforeEach(() => vi.clearAllMocks());

describe("admin auth", () => {
  it("rejects a request with no key", async () => {
    const res = await request(app).get("/api/v1/admin/documents");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("unauthorized");
  });

  it("rejects a wrong key", async () => {
    const res = await request(app).get("/api/v1/admin/documents").set("x-admin-key", "wrong");
    expect(res.status).toBe(401);
  });

  it("accepts the right key", async () => {
    const res = await request(app).get("/api/v1/admin/documents").set("x-admin-key", KEY);
    expect(res.status).toBe(200);
    expect(res.body.documents).toHaveLength(1);
  });
});

describe("POST /api/v1/admin/documents", () => {
  const upload = () => request(app).post("/api/v1/admin/documents").set("x-admin-key", KEY);

  it("queues a PDF and answers 202 with the job id", async () => {
    const res = await upload().attach("file", pdfBytes, { filename: "Employee Handbook.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(202);
    expect(res.headers.location).toBe("/api/v1/admin/documents/jobs/job-1");
    expect(res.body).toMatchObject({ jobId: "job-1", docId: "employee-handbook", title: "Employee Handbook" });
  });

  it("uses docId and title from the form when given", async () => {
    await upload()
      .field("docId", "hr-policy")
      .field("title", "HR Policy 2026")
      .attach("file", pdfBytes, { filename: "x.pdf", contentType: "application/pdf" });
    expect(ingestion.enqueue).toHaveBeenCalledWith(expect.objectContaining({ docId: "hr-policy", title: "HR Policy 2026" }));
  });

  it("rejects a non-PDF content type", async () => {
    const res = await upload().attach("file", Buffer.from("hello"), { filename: "notes.txt", contentType: "text/plain" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("not_a_pdf");
  });

  it("rejects a file that claims to be a PDF but isn't", async () => {
    const res = await upload().attach("file", Buffer.from("hello"), { filename: "fake.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("not_a_pdf");
  });

  it("rejects a request with no file", async () => {
    const res = await upload().field("title", "x");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("missing_file");
  });

  it("rejects an invalid docId", async () => {
    const res = await upload()
      .field("docId", "Bad Id!")
      .attach("file", pdfBytes, { filename: "x.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_fields");
  });
});

describe("jobs and deletes", () => {
  it("returns a job's status", async () => {
    vi.mocked(ingestion.getJob).mockReturnValueOnce({ id: "job-1", status: "done", chunks: 6 } as never);
    const res = await request(app).get("/api/v1/admin/documents/jobs/job-1").set("x-admin-key", KEY);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "done", chunks: 6 });
  });

  it("404s an unknown job", async () => {
    const res = await request(app).get("/api/v1/admin/documents/jobs/nope").set("x-admin-key", KEY);
    expect(res.status).toBe(404);
  });

  it("deletes a document", async () => {
    vi.mocked(ingestion.deleteDocument).mockResolvedValueOnce(6);
    const res = await request(app).delete("/api/v1/admin/documents/handbook").set("x-admin-key", KEY);
    expect(res.body).toEqual({ docId: "handbook", deletedChunks: 6 });
  });

  it("404s deleting a document that doesn't exist", async () => {
    vi.mocked(ingestion.deleteDocument).mockResolvedValueOnce(0);
    const res = await request(app).delete("/api/v1/admin/documents/nope").set("x-admin-key", KEY);
    expect(res.status).toBe(404);
  });
});

describe("error format", () => {
  it("returns JSON 404 for unknown routes", async () => {
    const res = await request(app).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_found");
  });

  it("turns an unexpected failure into a generic 500", async () => {
    vi.mocked(ingestion.listDocuments).mockRejectedValueOnce(new Error("chroma exploded: secret details"));
    const res = await request(app).get("/api/v1/admin/documents").set("x-admin-key", KEY);
    expect(res.status).toBe(500);
    expect(res.body.error).toEqual({ code: "internal_error", message: "Something went wrong" });
  });
});
