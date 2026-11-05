import { gemini } from "../clients/gemini.js";
import { env } from "../config/env.js";
import { withRetry } from "../lib/retry.js";

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

async function embedBatch(texts: string[], taskType: TaskType, title?: string): Promise<number[][]> {
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
    { label: "Gemini embedContent" },
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
 * The output order always matches the input order.
 */
export async function embedDocuments(texts: string[], title?: string): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    vectors.push(...(await embedBatch(batch, "RETRIEVAL_DOCUMENT", title)));
  }
  return vectors;
}

/** Embeds a single user question for searching. */
export async function embedQuery(text: string): Promise<number[]> {
  const [vector] = await embedBatch([text], "RETRIEVAL_QUERY");
  return vector;
}
