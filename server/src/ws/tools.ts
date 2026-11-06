import { Type, type FunctionCall, type FunctionDeclaration, type FunctionResponse } from "@google/genai";
import type { Logger } from "pino";
import { retrieveContext } from "../services/rag.service.js";

/**
 * What we tell Gemini about the tool: only a name, a description and the
 * arguments it takes. Gemini reads the description to decide WHEN to call
 * it, so it says plainly what the tool is for.
 */
export const SEARCH_HANDBOOK = "search_handbook";

export const searchHandbookDeclaration: FunctionDeclaration = {
  name: SEARCH_HANDBOOK,
  description:
    "Search the company employee handbook. Use it for every question about company policies, leave, sick days, " +
    "benefits, pay, working hours, remote work, conduct or procedures. Returns the most relevant handbook passages.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description: "A short search phrase describing what to look up, e.g. 'sick leave days per year'.",
      },
    },
    required: ["query"],
  },
};

export interface ToolCallDeps {
  /** Tell our client a search is happening (shows "Searching the handbook…"). */
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
 * A failure is reported back to Gemini as an error result (so it can tell
 * the user it couldn't search) rather than leaving the call unanswered.
 */
export async function runToolCalls(calls: FunctionCall[], deps: ToolCallDeps, log: Logger): Promise<void> {
  const responses = await Promise.all(
    calls.map(async (call): Promise<FunctionResponse> => {
      const { id, name } = call;
      if (name !== SEARCH_HANDBOOK) {
        return { id, name, response: { error: `Unknown tool "${name}"` } };
      }

      const query = String(call.args?.query ?? "").trim();
      deps.notify(SEARCH_HANDBOOK, query);
      log.info({ query }, "search_handbook called");
      try {
        const { contextText } = await retrieveContext(query);
        return { id, name, response: { result: contextText } };
      } catch (err) {
        log.error({ err, query }, "search_handbook failed");
        return { id, name, response: { error: "The handbook search is unavailable right now." } };
      }
    }),
  );

  // If the user interrupted while we were searching, Gemini has moved on.
  const live = responses.filter((r) => !r.id || !deps.isCancelled(r.id));
  if (live.length > 0) deps.respond(live);
}
