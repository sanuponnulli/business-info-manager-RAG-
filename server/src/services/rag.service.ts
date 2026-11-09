import { getCollection } from "../clients/chroma.js";
import { embedQuery } from "./embedding.service.js";
import type { ChunkMetadata } from "./ingestion.service.js";

export const DEFAULT_TOP_K = 3;

export interface RetrievedChunk {
  text: string;
  docId: string;
  title: string;
  page: number;
  /** 0–1, higher = closer in meaning to the question. */
  score: number;
}

export interface RetrievedContext {
  chunks: RetrievedChunk[];
  /** The chunks as numbered, labelled text, ready to paste into a prompt. */
  contextText: string;
}

/**
 * The shared RAG core: finds the k handbook chunks closest in meaning to
 * `query`. Both the text chat (Path A) and the voice agent's
 * search_handbook tool (Path B) call this, so retrieval behaves the same
 * whichever way the user asks.
 */
export async function retrieveContext(query: string, k = DEFAULT_TOP_K): Promise<RetrievedContext> {
  const question = query.trim();
  if (!question) throw new Error("retrieveContext: query is empty");

  const [vector, collection] = await Promise.all([embedQuery(question), getCollection()]);

  const result = await collection.query({
    queryEmbeddings: [vector],
    nResults: k,
    include: ["documents", "metadatas", "distances"],
  });

  // Chroma can run several queries at once, so every field is a list of
  // lists: one inner list per query. We sent one query, so take index [0].
  const documents = result.documents[0] ?? [];
  const metadatas = result.metadatas[0] ?? [];
  const distances = result.distances[0] ?? [];

  const chunks: RetrievedChunk[] = documents.map((text, i) => {
    const meta = (metadatas[i] ?? {}) as Partial<ChunkMetadata>;
    return {
      text: text ?? "",
      docId: meta.docId ?? "unknown",
      title: meta.title ?? "Untitled",
      page: meta.page ?? 0,
      // Cosine distance = 1 − cosine similarity, so flip it back:
      // distance 0.2 → score 0.8. Results arrive best-first.
      score: Number((1 - (distances[i] ?? 1)).toFixed(4)),
    };
  });

  return { chunks, contextText: formatContext(chunks) };
}

/**
 * Turns chunks into the text block the model reads, e.g.
 *
 *   [1] (Employee Handbook, p. 2)
 *   Employees are entitled to ten days of fully paid sick leave...
 *
 * The [n] numbers let the model cite its sources and let the app map a
 * citation back to the chunk (and page) it came from. `start` lets a second
 * search in the same answer continue the numbering ([4], [5], ...) instead
 * of reusing [1].
 */
export function formatContext(chunks: RetrievedChunk[], start = 1): string {
  if (chunks.length === 0) return "No relevant handbook content was found.";
  return chunks.map((c, i) => `[${start + i}] (${c.title}, p. ${c.page})\n${c.text}`).join("\n\n");
}
