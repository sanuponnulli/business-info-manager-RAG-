import {
  FunctionCallingConfigMode,
  ThinkingLevel,
  type Content,
  type FunctionCall,
  type FunctionResponse,
  type GenerateContentResponse,
} from "@google/genai";
import { gemini } from "../clients/gemini.js";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { isRetryable, withRetry } from "../lib/retry.js";
import { SEARCH_HANDBOOK, searchHandbookDeclaration } from "../ws/tools.js";
import { formatContext, retrieveContext, type RetrievedChunk } from "./rag.service.js";

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
 * The rules the model must follow. This is "grounding": for handbook
 * questions the model may only use the passages search_handbook returns,
 * not what it learned in training, and must admit when they don't contain
 * the answer. Small talk needs no search, so "hi" costs no retrieval.
 */
export const SYSTEM_INSTRUCTION = `You are a helpful assistant that answers employees' questions about the company handbook.

Rules:
- For ANY question about company policies, leave, benefits, pay, hours, conduct or procedures, call the search_handbook tool first. Never answer such questions from memory.
- If the first search doesn't cover the question, you may search again with different wording.
- Answer ONLY using the numbered passages search_handbook returns. Do not use outside knowledge or make anything up.
- Cite the passages you used with their numbers in square brackets, e.g. "You get ten days of sick leave [1]."
- If the passages do not contain the answer, say you couldn't find it in the handbook and suggest contacting HR. Do not guess.
- Greetings, thanks and small talk need no search: reply briefly and offer to help with handbook questions.
- Be concise and friendly. Use short paragraphs or bullet points.
- Earlier conversation is only for understanding follow-up questions; facts must still come from the passages.`;

/**
 * How many times the model may ask to search before it must answer with
 * what it has. Stops a model that keeps searching from looping forever.
 */
export const MAX_SEARCH_ROUNDS = 3;

/**
 * Path A of the diagram, as a tool-calling loop:
 *
 *   1. Send the question (plus history) and the search_handbook tool.
 *   2. If Gemini answers with text, we're done. ("hi" ends here, no search.)
 *   3. If Gemini asks for search_handbook, run retrieveContext, send the
 *      passages back as the tool's result, and go to 1 with the longer
 *      conversation.
 *
 * Every chunk returned by any search is kept, numbered in order, so the
 * [n] citations in the final answer map back to sources.
 */
export async function answerQuestion(question: string, history: ChatTurn[] = []): Promise<Answer> {
  const contents: Content[] = [
    ...history.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
    { role: "user", parts: [{ text: question }] },
  ];
  const chunks: RetrievedChunk[] = [];
  const generate = createGenerator();

  for (let round = 0; ; round++) {
    // On the last round, tools are switched off: the model has to answer now.
    const toolsAllowed = round < MAX_SEARCH_ROUNDS;
    const response = await generate(contents, toolsAllowed);
    const calls = response.functionCalls ?? [];

    if (calls.length === 0 || !toolsAllowed) {
      const answer = response.text?.trim();
      if (!answer) throw new Error("Gemini returned an empty answer");
      return { answer, sources: markCitations(answer, chunks) };
    }

    // Echo the model's turn back exactly as received: Gemini 3 attaches a
    // "thought signature" to function calls and rejects the next request
    // if it's missing.
    contents.push(response.candidates?.[0]?.content ?? { role: "model", parts: calls.map((functionCall) => ({ functionCall })) });

    const functionResponses = await runSearches(calls, chunks);
    contents.push({ role: "user", parts: functionResponses.map((functionResponse) => ({ functionResponse })) });
  }
}

/**
 * Runs the searches Gemini asked for (in parallel), then numbers the new
 * chunks after the ones already collected, so a second search's passages
 * are [4], [5], [6] rather than a second [1].
 * A failed search goes back to Gemini as an error result, so it can tell
 * the user it couldn't search instead of the whole request failing.
 */
async function runSearches(calls: FunctionCall[], chunks: RetrievedChunk[]): Promise<FunctionResponse[]> {
  const results = await Promise.all(
    calls.map(async (call): Promise<{ call: FunctionCall; found?: RetrievedChunk[]; error?: string }> => {
      if (call.name !== SEARCH_HANDBOOK) return { call, error: `Unknown tool "${call.name}"` };
      const query = String(call.args?.query ?? "").trim();
      logger.info({ query }, "search_handbook called (chat)");
      try {
        return { call, found: (await retrieveContext(query)).chunks };
      } catch (err) {
        logger.error({ err, query }, "search_handbook failed (chat)");
        return { call, error: "The handbook search is unavailable right now." };
      }
    }),
  );

  return results.map(({ call, found, error }) => {
    const { id, name } = call;
    if (!found) return { id, name, response: { error } };
    const start = chunks.length + 1;
    chunks.push(...found);
    return { id, name, response: { result: formatContext(found, start) } };
  });
}

/**
 * A person is waiting for this answer, so we don't sit on a struggling model:
 * CHAT_MODEL gets ONE try with a short time limit. If that fails with a
 * temporary error (503 "high demand", 504, timeout, rate limit), the request
 * goes straight to CHAT_FALLBACK_MODEL, which gets the normal time limit and
 * one retry. Once we've fallen back, the rest of this answer's rounds stay on
 * the fallback model rather than trying the struggling one again each time.
 */
const PRIMARY = { retries: 0, timeoutMs: 12_000 };
const FALLBACK = { retries: 1, timeoutMs: 30_000 };

type Generate = (contents: Content[], toolsAllowed: boolean) => Promise<GenerateContentResponse>;

function createGenerator(): Generate {
  const fallback = env.CHAT_FALLBACK_MODEL;
  const hasFallback = Boolean(fallback) && fallback !== env.CHAT_MODEL;
  let usingFallback = false;

  return async (contents, toolsAllowed) => {
    if (!usingFallback) {
      try {
        return await generate(env.CHAT_MODEL, contents, toolsAllowed, hasFallback ? PRIMARY : FALLBACK);
      } catch (err) {
        if (!hasFallback || !isRetryable(err)) throw err;
        const reason = err instanceof Error ? (err.name === "AbortError" ? "timed out" : err.message.slice(0, 120)) : String(err);
        logger.warn({ model: env.CHAT_MODEL, fallback, reason }, "Chat model unavailable, using fallback");
        usingFallback = true;
      }
    }
    return generate(fallback, contents, toolsAllowed, FALLBACK);
  };
}

async function generate(
  model: string,
  contents: Content[],
  toolsAllowed: boolean,
  limits: { retries: number; timeoutMs: number },
): Promise<GenerateContentResponse> {
  return withRetry(
    () =>
      gemini.models.generateContent({
        model,
        contents,
        config: {
          httpOptions: { timeout: limits.timeoutMs },
          systemInstruction: SYSTEM_INSTRUCTION,
          maxOutputTokens: 1024,
          // Gemini 3 "thinks" before answering. LOW keeps replies fast; deciding
          // whether to search and quoting a few passages doesn't need deep reasoning.
          // (Temperature is left at the default, as Google advises for Gemini 3.)
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          tools: [{ functionDeclarations: [searchHandbookDeclaration] }],
          // AUTO: the model decides between searching and answering.
          // NONE: it may not search any more and must answer in text.
          toolConfig: {
            functionCallingConfig: { mode: toolsAllowed ? FunctionCallingConfigMode.AUTO : FunctionCallingConfigMode.NONE },
          },
        },
      }),
    { label: `Gemini generateContent (${model})`, retries: limits.retries, maxDelayMs: 5_000 },
  );
}

/** Numbers the chunks [1], [2], ... and marks which ones the answer cites. */
export function markCitations(answer: string, chunks: RetrievedChunk[]): Source[] {
  // Matches "[1]", "[1, 2]" and "[1,2,3]"; then pulls out every number inside.
  const cited = new Set(
    [...answer.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)].flatMap((m) => m[1].split(",").map((n) => Number(n.trim()))),
  );
  return chunks.map((c, i) => ({ ...c, n: i + 1, cited: cited.has(i + 1) }));
}
