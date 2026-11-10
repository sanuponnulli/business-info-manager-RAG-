import type { FunctionCall, FunctionResponse } from "@google/genai";
import type { Logger } from "pino";
import { todayString } from "../lib/dates.js";
import { executeToolCalls, type ToolContext } from "../tools/registry.js";

/**
 * Voice's side of tool calling. The tools themselves, and who may use them,
 * live in tools/registry.ts, shared with text chat.
 */

export interface ToolCallDeps {
  /** Tell our client a tool is running (shows "Searching the handbook…" / "Checking your leave…"). */
  notify: (name: string, query: string) => void;
  /** Send the results back to Gemini. */
  respond: (responses: FunctionResponse[]) => void;
  /** True if Gemini cancelled this call meanwhile (the user interrupted). */
  isCancelled: (id: string) => boolean;
}

/**
 * Runs the function calls Gemini asked for and answers each one.
 * Every response carries the same `id` as its call; that's how Gemini
 * matches answers to questions when several are in flight.
 * A failure (or a refused call) goes back to Gemini as an error result, so it
 * can tell the user, rather than leaving the call unanswered.
 */
export async function runToolCalls(
  calls: FunctionCall[],
  deps: ToolCallDeps,
  log: Logger,
  ctx: ToolContext = { user: null, today: todayString() },
): Promise<void> {
  for (const call of calls) deps.notify(call.name ?? "", String(call.args?.query ?? ""));

  // Fresh chunk list per round: spoken answers don't read out [n] numbers.
  const responses = await executeToolCalls(calls, { ...ctx, today: todayString() }, [], log);

  // If the user interrupted while we were working, Gemini has moved on.
  const live = responses.filter((r) => !r.id || !deps.isCancelled(r.id));
  if (live.length > 0) deps.respond(live);
}
