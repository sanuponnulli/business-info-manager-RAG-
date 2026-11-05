import type { RequestHandler } from "express";
import { z } from "zod";
import { HttpError } from "../lib/httpError.js";
import { slugify } from "../lib/slug.js";
import * as ingestion from "../services/ingestion.service.js";

/**
 * Controllers are the thin layer between HTTP and the services: they read
 * and validate the request, call a service, and shape the response.
 * They contain no business logic of their own.
 */

/** Optional text fields sent alongside the uploaded file. */
const UploadFields = z.object({
  docId: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "docId may only contain lowercase letters, digits and single dashes")
    .max(80)
    .optional(),
  title: z.string().trim().min(1).max(200).optional(),
});

/** POST /api/v1/admin/documents (multipart: file, docId?, title?) */
export const uploadDocument: RequestHandler = (req, res) => {
  const file = req.file;
  if (!file) throw new HttpError(400, "missing_file", 'Send the PDF in a form field named "file"');

  // Every real PDF starts with the bytes "%PDF-". This catches a renamed
  // .txt or .docx that claimed to be a PDF.
  if (!file.buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new HttpError(400, "not_a_pdf", "The file is not a valid PDF");
  }

  const fields = UploadFields.safeParse(req.body ?? {});
  if (!fields.success) {
    throw new HttpError(400, "invalid_fields", fields.error.issues.map((i) => i.message).join("; "));
  }

  const docId = fields.data.docId ?? slugify(file.originalname);
  if (!docId) throw new HttpError(400, "invalid_fields", "Could not derive a docId from the file name; send one");
  const title = fields.data.title ?? file.originalname.replace(/\.pdf$/i, "");

  const job = ingestion.enqueue({ pdf: file.buffer, docId, title });

  // 202 Accepted: "got it, still working on it". Location tells the client where to poll.
  res
    .status(202)
    .location(`/api/v1/admin/documents/jobs/${job.id}`)
    .json({ jobId: job.id, docId: job.docId, title: job.title, status: job.status });
};

/** GET /api/v1/admin/documents/jobs/:jobId */
export const getJobStatus: RequestHandler<{ jobId: string }> = (req, res) => {
  const job = ingestion.getJob(req.params.jobId);
  if (!job) throw new HttpError(404, "job_not_found", "No such job (it may have expired)");
  res.json(job);
};

/** GET /api/v1/admin/documents */
export const listDocuments: RequestHandler = async (_req, res) => {
  res.json({ documents: await ingestion.listDocuments() });
};

/** DELETE /api/v1/admin/documents/:docId */
export const deleteDocument: RequestHandler<{ docId: string }> = async (req, res) => {
  const deleted = await ingestion.deleteDocument(req.params.docId);
  if (deleted === 0) throw new HttpError(404, "document_not_found", `No document with docId "${req.params.docId}"`);
  res.json({ docId: req.params.docId, deletedChunks: deleted });
};
