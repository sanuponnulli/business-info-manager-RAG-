import { ChromaClient, type Collection } from "chromadb";
import { env } from "../config/env.js";

const url = new URL(env.CHROMA_URL);

/** One shared connection to the ChromaDB server (running in Docker). */
export const chroma = new ChromaClient({
  host: url.hostname,
  port: Number(url.port) || (url.protocol === "https:" ? 443 : 80),
  ssl: url.protocol === "https:",
});

let collectionPromise: Promise<Collection> | null = null;

/**
 * Returns the handbook collection, creating it on first use.
 *
 * - `space: "cosine"`: similarity is measured by the angle between vectors,
 *   which is what Gemini embeddings are designed for.
 * - `embeddingFunction: null`: we compute embeddings ourselves with Gemini,
 *   so Chroma must not try to load its own built-in embedding model.
 *
 * The promise is cached so every caller shares one collection handle.
 */
export function getCollection(): Promise<Collection> {
  if (!collectionPromise) {
    collectionPromise = chroma
      .getOrCreateCollection({
        name: env.CHROMA_COLLECTION,
        configuration: { hnsw: { space: "cosine" } },
        embeddingFunction: null,
      })
      .catch((err) => {
        // Don't cache a failure (e.g. Chroma was down); retry on the next call.
        collectionPromise = null;
        throw err;
      });
  }
  return collectionPromise;
}

/** True if the Chroma server answers its heartbeat. */
export async function isChromaUp(): Promise<boolean> {
  try {
    await chroma.heartbeat();
    return true;
  } catch {
    return false;
  }
}
