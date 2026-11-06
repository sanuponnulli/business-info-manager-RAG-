import { ThinkingLevel, type Content } from "@google/genai";
import { gemini } from "../clients/gemini.js";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { isRetryable, withRetry } from "../lib/retry.js";
import { retrieveContext, type RetrievedChunk } from "./rag.service.js";

export interface ChatTurn {
  role: "user" | "model";
  text: string;
}

export interface Source extends RetrievedChunk {
  /** The [n] number the answer uses to cite this chunk. */
  n: number;
  /** True if the answer actually cites [n]. */
  cited: boolean;
}

export interface Answer {
  answer: string;
  sources: Source[];
}

/**
 * The rules the model must follow. This is "grounding": the model may only
 * use the handbook passages we give it, not what it learned in training,
 * and must admit when the passages don't contain the answer.
 */
export const SYSTEM_INSTRUCTION = `You are a helpful assistant that answers employees' questions about the company handbook.

Rules:
- Answer ONLY using the numbered handbook passages provided with the question. Do not use outside knowledge or make anything up.
- Cite the passages you used with their numbers in square brackets, e.g. "You get ten days of sick leave [1]."
- If the passages do not contain the answer, say you couldn't find it in the handbook and suggest contacting HR. Do not guess.
- Be concise and friendly. Use short paragraphs or bullet points.
- Earlier conversation is only for understanding follow-up questions; facts must still come from the passages.`;

/**
 * Path A of the diagram: retrieve handbook context for the question, then
 * ask Gemini to answer from that context only.
 */
export async function answerQuestion(question: string, history: ChatTurn[] = []): Promise<Answer> {
  const { chunks, contextText } = await retrieveContext(question);

  // Earlier turns go first, then the new question with its passages attached.
  const contents: Content[] = [
    ...history.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
    {
      role: "user",
      parts: [{ text: `Handbook passages:\n\n${contextText}\n\nQuestion: ${question}` }],
    },
  ];

  const answer = await generateWithFallback(contents);
  return { answer, sources: markCitations(answer, chunks) };
}

/**
 * Asks CHAT_MODEL; if it's still failing with a temporary error after one
 * retry (e.g. 503 "high demand"), asks CHAT_FALLBACK_MODEL instead.
 * A person is waiting for this answer, so we retry less than ingestion does.
 */
async function generateWithFallback(contents: Content[]): Promise<string> {
  try {
    return await generate(env.CHAT_MODEL, contents);
  } catch (err) {
    const fallback = env.CHAT_FALLBACK_MODEL;
    if (!fallback || fallback === env.CHAT_MODEL || !isRetryable(err)) throw err;
    logger.warn({ err, model: env.CHAT_MODEL, fallback }, "Chat model unavailable, using fallback");
    return generate(fallback, contents);
  }
}

async function generate(model: string, contents: Content[]): Promise<string> {
  const response = await withRetry(
    () =>
      gemini.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          maxOutputTokens: 1024,
          // Gemini 3 "thinks" before answering. LOW keeps replies fast; reading a
          // few passages and quoting them doesn't need deep reasoning.
          // (Temperature is left at the default, as Google advises for Gemini 3.)
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      }),
    { label: `Gemini generateContent (${model})`, retries: 1 },
  );

  const answer = response.text?.trim();
  if (!answer) throw new Error("Gemini returned an empty answer");
  return answer;
}

/** Numbers the chunks [1], [2], ... and marks which ones the answer cites. */
export function markCitations(answer: string, chunks: RetrievedChunk[]): Source[] {
  // Matches "[1]", "[1, 2]" and "[1,2,3]"; then pulls out every number inside.
  const cited = new Set(
    [...answer.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)].flatMap((m) => m[1].split(",").map((n) => Number(n.trim()))),
  );
  return chunks.map((c, i) => ({ ...c, n: i + 1, cited: cited.has(i + 1) }));
}
