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
