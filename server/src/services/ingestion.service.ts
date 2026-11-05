import { randomUUID } from "node:crypto";
import { getCollection } from "../clients/chroma.js";
import { logger } from "../lib/logger.js";
import { extractPages } from "../ingestion/pdf.js";
import { chunkPages } from "../ingestion/chunker.js";
import { embedDocuments } from "./embedding.service.js";

export type JobStatus = "queued" | "processing" | "done" | "failed";

export interface Job {
  id: string;
  docId: string;
  title: string;
  status: JobStatus;
  /** Number of chunks stored, once done. */
  chunks?: number;
  /** Why it failed, if it failed. */
  error?: string;
  createdAt: string;
  finishedAt?: string;
}

export interface DocumentSummary {
  docId: string;
  title: string;
  chunks: number;
  uploadedAt: string;
}

/** What we store next to every chunk in ChromaDB. */
interface ChunkMetadata {
  docId: string;
  title: string;
  page: number;
  chunkIndex: number;
  uploadedAt: string;
  [key: string]: string | number;
}

/** Chroma limits how many records one request may carry; stay well under it. */
const CHROMA_WRITE_BATCH = 500;
/** Finished jobs kept in memory so their status can still be read. */
const MAX_FINISHED_JOBS = 100;

// --- In-memory job queue -------------------------------------------------
// `jobs` remembers every job's status; `queue` holds work not yet started
// (with the PDF bytes, which we drop once the job runs).

const jobs = new Map<string, Job>();
const queue: { job: Job; pdf: Buffer }[] = [];
let working = false;

/**
 * Adds a PDF to the queue and returns immediately with a job the caller can
 * poll. The actual work happens in the background, one job at a time.
 */
export function enqueue(input: { pdf: Buffer; docId: string; title: string }): Job {
  const job: Job = {
    id: randomUUID(),
    docId: input.docId,
    title: input.title,
    status: "queued",
    createdAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);
  queue.push({ job, pdf: input.pdf });
  // Start the worker on the next tick (if idle), so this function returns
  // first and the caller sees the job as "queued". We never await it.
  setImmediate(() => void drainQueue());
  return { ...job };
}

/** Returns a copy, so callers can't accidentally change the stored job. */
export function getJob(id: string): Job | undefined {
  const job = jobs.get(id);
  return job && { ...job };
}

/** Works through the queue until it's empty. Only one copy ever runs at a time. */
async function drainQueue(): Promise<void> {
  if (working) return;
  working = true;
  try {
    let next;
    while ((next = queue.shift())) {
      await runJob(next.job, next.pdf);
    }
  } finally {
    working = false;
  }
}

async function runJob(job: Job, pdf: Buffer): Promise<void> {
  job.status = "processing";
  const log = logger.child({ jobId: job.id, docId: job.docId });
  log.info("Ingestion started");
  try {
    job.chunks = await ingestDocument(pdf, job.docId, job.title);
    job.status = "done";
    log.info({ chunks: job.chunks }, "Ingestion finished");
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : String(err);
    log.error({ err }, "Ingestion failed");
  } finally {
    job.finishedAt = new Date().toISOString();
    pruneFinishedJobs();
  }
}

/** Stops the job map growing forever: forget the oldest finished jobs. */
function pruneFinishedJobs(): void {
  const finished = [...jobs.values()].filter((j) => j.finishedAt);
  for (const j of finished.slice(0, Math.max(0, finished.length - MAX_FINISHED_JOBS))) {
    jobs.delete(j.id);
  }
}

// --- The pipeline ----------------------------------------------------------

/**
 * PDF → pages → chunks → vectors → ChromaDB. Returns the number of chunks stored.
 *
 * Order matters: we do all the slow, failure-prone work (parsing, embedding)
 * BEFORE touching the database. Only once every vector is ready do we delete
 * the old version and write the new one, so a failed upload leaves the
 * previous version of the document fully searchable.
 */
export async function ingestDocument(pdf: Buffer, docId: string, title: string): Promise<number> {
  const pages = await extractPages(pdf);
  const chunks = await chunkPages(pages);
  const vectors = await embedDocuments(
    chunks.map((c) => c.text),
    title,
  );

  const uploadedAt = new Date().toISOString();
  const collection = await getCollection();

  await collection.delete({ where: { docId } });

  for (let i = 0; i < chunks.length; i += CHROMA_WRITE_BATCH) {
    const batch = chunks.slice(i, i + CHROMA_WRITE_BATCH);
    await collection.add({
      // Predictable ids: chunk 7 of "employee-handbook" is always "employee-handbook::7".
      ids: batch.map((c) => `${docId}::${c.chunkIndex}`),
      embeddings: vectors.slice(i, i + CHROMA_WRITE_BATCH),
      documents: batch.map((c) => c.text),
      metadatas: batch.map<ChunkMetadata>((c) => ({
        docId,
        title,
        page: c.page,
        chunkIndex: c.chunkIndex,
        uploadedAt,
      })),
    });
  }
  return chunks.length;
}

// --- Document management ---------------------------------------------------

/**
 * Lists stored documents. Chroma stores chunks, not documents, so we read
 * every chunk's metadata (a page at a time) and group by docId.
 */
export async function listDocuments(): Promise<DocumentSummary[]> {
  const collection = await getCollection();
  const docs = new Map<string, DocumentSummary>();
  const PAGE = 1000;

  for (let offset = 0; ; offset += PAGE) {
    const { metadatas } = await collection.get({ include: ["metadatas"], limit: PAGE, offset });
    for (const m of metadatas) {
      if (!m) continue;
      const meta = m as ChunkMetadata;
      const doc = docs.get(meta.docId);
      if (doc) doc.chunks++;
      else docs.set(meta.docId, { docId: meta.docId, title: meta.title, chunks: 1, uploadedAt: meta.uploadedAt });
    }
    if (metadatas.length < PAGE) break;
  }
  return [...docs.values()].sort((a, b) => a.title.localeCompare(b.title));
}

/** Deletes every chunk of a document. Returns how many chunks were removed. */
export async function deleteDocument(docId: string): Promise<number> {
  const collection = await getCollection();
  const { ids } = await collection.get({ where: { docId }, include: [] });
  if (ids.length > 0) await collection.delete({ where: { docId } });
  return ids.length;
}
