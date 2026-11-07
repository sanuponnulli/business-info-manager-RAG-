import { gemini } from "../clients/gemini.js";
import { env } from "../config/env.js";
import { withRetry, type RetryOptions } from "../lib/retry.js";

/** gemini-embedding-001 returns 3072 numbers per text at full size. */
export const EMBEDDING_DIMENSIONS = 3072;

/** The Gemini API accepts at most 100 texts in one embedding request. */
const BATCH_SIZE = 100;

/**
 * Gemini produces slightly different vectors depending on how the text
 * will be used. Stored chunks are embedded as RETRIEVAL_DOCUMENT and
 * questions as RETRIEVAL_QUERY; the model is trained so that a question
 * lands close to the passages that answer it.
 */
type TaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

/**
 * Uploads run in the background, so they can afford to wait out a rate
 * limit (the free tier allows 100 embeddings a minute and asks us to wait
 * up to a minute). A question has a person waiting, so it gives up fast.
 */
const DOCUMENT_RETRY: RetryOptions = { retries: 8, maxDelayMs: 90_000 };
const QUERY_RETRY: RetryOptions = { retries: 2, maxDelayMs: 5_000 };

async function embedBatch(texts: string[], taskType: TaskType, title?: string): Promise<number[][]> {
  const retry = taskType === "RETRIEVAL_DOCUMENT" ? DOCUMENT_RETRY : QUERY_RETRY;
  const response = await withRetry(
    () =>
      gemini.models.embedContent({
        model: env.EMBEDDING_MODEL,
        contents: texts,
        config: {
          taskType,
          outputDimensionality: EMBEDDING_DIMENSIONS,
          // A document title gives the model extra context; only allowed for documents.
          ...(taskType === "RETRIEVAL_DOCUMENT" && title ? { title } : {}),
        },
      }),
    { ...retry, label: "Gemini embedContent" },
  );

  const vectors = (response.embeddings ?? []).map((e) => e.values ?? []);

  // Never store bad data: a missing or wrong-sized vector would silently break search later.
  if (vectors.length !== texts.length) {
    throw new Error(`Expected ${texts.length} embeddings, got ${vectors.length}`);
  }
  for (const v of vectors) {
    if (v.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(`Expected ${EMBEDDING_DIMENSIONS}-d embedding, got ${v.length}-d`);
    }
  }
  return vectors;
}

/**
 * Embeds document chunks for storage. Splits the input into batches of 100
 * and sends them one after another (sequentially keeps us under rate limits).
 * The output order always matches the input order. `onProgress` reports
 * how many texts are done after each batch, so a long upload can show progress.
 */
export async function embedDocuments(
  texts: string[],
  title?: string,
  onProgress?: (done: number, total: number) => void,
): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    vectors.push(...(await embedBatch(batch, "RETRIEVAL_DOCUMENT", title)));
    onProgress?.(vectors.length, texts.length);
  }
  return vectors;
}

/** Embeds a single user question for searching. */
export async function embedQuery(text: string): Promise<number[]> {
  const [vector] = await embedBatch([text], "RETRIEVAL_QUERY");
  return vector;
}
