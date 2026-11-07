/**
 * Every call to the backend goes through this file. The types mirror the
 * backend's responses (see server/README.md), so the pages get typed data.
 * URLs are relative ("/api/..."): Vite's proxy forwards them to the server.
 */

/** The backend's error shape: { "error": { "code", "message" } }. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, adminKey?: string): Promise<T> {
  const headers = new Headers(init.headers);
  if (adminKey) headers.set("x-admin-key", adminKey);

  let res: Response;
  try {
    res = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiError(0, "network_error", "Can't reach the server. Is it running on port 3000?");
  }

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = body?.error;
    throw new ApiError(res.status, err?.code ?? "http_error", err?.message ?? `Request failed (${res.status})`);
  }
  return body as T;
}

// --- Types (mirroring the backend) --------------------------------------

export interface Health {
  status: "ok" | "degraded";
  chroma: "ok" | "down";
}

export interface DocumentSummary {
  docId: string;
  title: string;
  chunks: number;
  uploadedAt: string;
}

// --- Calls -------------------------------------------------------------

/** /health answers 503 when ChromaDB is down, but still with a useful body. */
export async function getHealth(): Promise<Health> {
  try {
    return await request<Health>("/health");
  } catch (err) {
    if (err instanceof ApiError && err.status === 503) return { status: "degraded", chroma: "down" };
    throw err;
  }
}

export function listDocuments(adminKey: string) {
  return request<{ documents: DocumentSummary[] }>("/api/v1/admin/documents", {}, adminKey).then((r) => r.documents);
}

export type JobStatus = "queued" | "processing" | "done" | "failed";

export interface Job {
  id: string;
  docId: string;
  title: string;
  status: JobStatus;
  chunks?: number;
  /** While processing: chunks embedded so far, out of the total. */
  progress?: { embedded: number; total: number };
  error?: string;
  createdAt: string;
  finishedAt?: string;
}

/**
 * Uploads a PDF. The server answers straight away (202) with a job id;
 * the actual processing happens in the background, so poll getJob().
 */
export function uploadDocument(adminKey: string, file: File, fields: { title?: string; docId?: string }) {
  const form = new FormData();
  form.append("file", file);
  if (fields.title) form.append("title", fields.title);
  if (fields.docId) form.append("docId", fields.docId);
  // No Content-Type header: the browser sets multipart/form-data with the right boundary itself.
  return request<{ jobId: string; docId: string; title: string; status: JobStatus }>(
    "/api/v1/admin/documents",
    { method: "POST", body: form },
    adminKey,
  );
}

export function getJob(adminKey: string, jobId: string) {
  return request<Job>(`/api/v1/admin/documents/jobs/${encodeURIComponent(jobId)}`, {}, adminKey);
}

export interface ChatTurn {
  role: "user" | "model";
  text: string;
}

export interface Source {
  /** The [n] the answer uses for this passage. */
  n: number;
  /** True if the answer actually cites [n]. */
  cited: boolean;
  text: string;
  docId: string;
  title: string;
  page: number;
  /** 0–1 similarity to the question. */
  score: number;
}

/** The employee-facing text endpoint (no admin key needed). */
export function ask(question: string, history: ChatTurn[]) {
  return request<{ answer: string; sources: Source[] }>("/api/v1/chat/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, history }),
  });
}

export function deleteDocument(adminKey: string, docId: string) {
  return request<{ docId: string; deletedChunks: number }>(
    `/api/v1/admin/documents/${encodeURIComponent(docId)}`,
    { method: "DELETE" },
    adminKey,
  );
}
