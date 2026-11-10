import {
  FunctionCallingConfigMode,
  ThinkingLevel,
  type Content,
  type FunctionDeclaration,
  type GenerateContentResponse,
} from "@google/genai";
import { gemini } from "../clients/gemini.js";
import { env } from "../config/env.js";
import { todayString } from "../lib/dates.js";
import { logger } from "../lib/logger.js";
import { isRetryable, withRetry } from "../lib/retry.js";
import type { AuthUser } from "../middleware/userAuth.js";
import { chatInstruction } from "../tools/instructions.js";
import { executeToolCalls, toolDeclarationsFor } from "../tools/registry.js";
import type { RetrievedChunk } from "./rag.service.js";

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
  /** Handbook passages found, numbered as the answer cites them. */
  sources: Source[];
  /** Names of the tools the model called, in order (e.g. ["search_handbook", "get_my_leave_balances"]). */
  toolsUsed: string[];
}

/**
 * How many rounds of tool calls the model may make before it must answer with
 * what it has. Stops a model that keeps calling tools from looping forever.
 * (One round can hold several calls, e.g. a handbook search plus a balance lookup.)
 */
export const MAX_TOOL_ROUNDS = 3;

/**
 * Path A of the diagram, as a tool-calling loop:
 *
 *   1. Send the question (plus history) and the tools this user may use
 *      (not signed in: handbook only; see tools/registry.ts).
 *   2. If Gemini answers with text, we're done. ("hi" ends here, no tools.)
 *   3. If Gemini asks for tools (handbook search, leave balance, ...), run
 *      them as this user, send the results back, and go to 1 with the
 *      longer conversation.
 *
 * Every handbook chunk returned by any search is kept, numbered in order, so
 * the [n] citations in the final answer map back to sources.
 */
export async function answerQuestion(question: string, history: ChatTurn[] = [], user: AuthUser | null = null): Promise<Answer> {
  const contents: Content[] = [
    ...history.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
    { role: "user", parts: [{ text: question }] },
  ];
  const today = todayString();
  const chunks: RetrievedChunk[] = [];
  const toolsUsed: string[] = [];
  const generate = createGenerator({ systemInstruction: chatInstruction(user, today), declarations: toolDeclarationsFor(user) });
  const log = logger.child({ userId: user?.id ?? null });

  for (let round = 0; ; round++) {
    // On the last round, tools are switched off: the model has to answer now.
    const toolsAllowed = round < MAX_TOOL_ROUNDS;
    const response = await generate(contents, toolsAllowed);
    const calls = response.functionCalls ?? [];

    if (calls.length === 0 || !toolsAllowed) {
      const answer = response.text?.trim();
      if (!answer) throw new Error("Gemini returned an empty answer");
      return { answer, sources: markCitations(answer, chunks), toolsUsed };
    }

    // Echo the model's turn back exactly as received: Gemini 3 attaches a
    // "thought signature" to function calls and rejects the next request
    // if it's missing.
    contents.push(response.candidates?.[0]?.content ?? { role: "model", parts: calls.map((functionCall) => ({ functionCall })) });

    toolsUsed.push(...calls.map((c) => c.name ?? "unknown"));
    const functionResponses = await executeToolCalls(calls, { user, today }, chunks, log);
    contents.push({ role: "user", parts: functionResponses.map((functionResponse) => ({ functionResponse })) });
  }
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

/** What stays the same for every round of one answer. */
interface Setup {
  systemInstruction: string;
  declarations: FunctionDeclaration[];
}

function createGenerator(setup: Setup): Generate {
  const fallback = env.CHAT_FALLBACK_MODEL;
  const hasFallback = Boolean(fallback) && fallback !== env.CHAT_MODEL;
  let usingFallback = false;

  return async (contents, toolsAllowed) => {
    if (!usingFallback) {
      try {
        return await generate(env.CHAT_MODEL, setup, contents, toolsAllowed, hasFallback ? PRIMARY : FALLBACK);
      } catch (err) {
        if (!hasFallback || !isRetryable(err)) throw err;
        const reason = err instanceof Error ? (err.name === "AbortError" ? "timed out" : err.message.slice(0, 120)) : String(err);
        logger.warn({ model: env.CHAT_MODEL, fallback, reason }, "Chat model unavailable, using fallback");
        usingFallback = true;
      }
    }
    return generate(fallback, setup, contents, toolsAllowed, FALLBACK);
  };
}

async function generate(
  model: string,
  setup: Setup,
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
          systemInstruction: setup.systemInstruction,
          maxOutputTokens: 1024,
          // Gemini 3 "thinks" before answering. LOW keeps replies fast; picking a
          // tool and quoting a few passages or numbers doesn't need deep reasoning.
          // (Temperature is left at the default, as Google advises for Gemini 3.)
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          tools: [{ functionDeclarations: setup.declarations }],
          // AUTO: the model decides between calling tools and answering.
          // NONE: it may not call tools any more and must answer in text.
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
