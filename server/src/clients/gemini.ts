import { GoogleGenAI } from "@google/genai";
import { env } from "../config/env.js";

/**
 * One shared Gemini client for the whole app. The same object is used for
 * embeddings (Chunk 2), text answers (Chunk 7) and the Live voice API (Chunk 8).
 * Creating it once avoids re-reading the key and re-building it per request.
 */
export const gemini = new GoogleGenAI({
  apiKey: env.GEMINI_API_KEY,
  // Give up on any single HTTP call after 30s instead of waiting forever.
  // (withRetry decides whether to try again.)
  httpOptions: { timeout: 30_000 },
});
