import { describe, it, expect, vi, beforeEach } from "vitest";
import { pino } from "pino";

vi.mock("../src/services/rag.service.js", () => ({
  retrieveContext: vi.fn(async (query: string) => ({ chunks: [], contextText: `[1] passage about ${query}` })),
}));

import { retrieveContext } from "../src/services/rag.service.js";
import { runToolCalls, type ToolCallDeps } from "../src/ws/tools.js";

const log = pino({ level: "silent" });
let deps: ToolCallDeps & { notify: ReturnType<typeof vi.fn>; respond: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  deps = { notify: vi.fn(), respond: vi.fn(), isCancelled: () => false };
});

describe("runToolCalls", () => {
  it("searches the handbook and answers with the SAME id", async () => {
    await runToolCalls([{ id: "call-42", name: "search_handbook", args: { query: "sick days" } }], deps, log);

    expect(retrieveContext).toHaveBeenCalledWith("sick days");
    expect(deps.notify).toHaveBeenCalledWith("search_handbook", "sick days");
    expect(deps.respond).toHaveBeenCalledWith([
      { id: "call-42", name: "search_handbook", response: { result: "[1] passage about sick days" } },
    ]);
  });

  it("answers several calls in one response, each with its own id", async () => {
    await runToolCalls(
      [
        { id: "a", name: "search_handbook", args: { query: "leave" } },
        { id: "b", name: "search_handbook", args: { query: "remote work" } },
      ],
      deps,
      log,
    );
    const [responses] = deps.respond.mock.calls[0];
    expect(responses.map((r: { id: string }) => r.id)).toEqual(["a", "b"]);
  });

  it("reports a failed search to Gemini as an error instead of leaving it hanging", async () => {
    vi.mocked(retrieveContext).mockRejectedValueOnce(new Error("chroma down"));
    await runToolCalls([{ id: "x", name: "search_handbook", args: { query: "pay" } }], deps, log);
    expect(deps.respond).toHaveBeenCalledWith([
      { id: "x", name: "search_handbook", response: { error: "The handbook search is unavailable right now." } },
    ]);
  });

  it("rejects unknown tools", async () => {
    await runToolCalls([{ id: "y", name: "delete_everything", args: {} }], deps, log);
    expect(retrieveContext).not.toHaveBeenCalled();
    expect(deps.respond.mock.calls[0][0][0].response.error).toMatch(/Unknown tool/);
  });

  it("drops the answer if Gemini cancelled the call meanwhile", async () => {
    deps.isCancelled = (id) => id === "z";
    await runToolCalls([{ id: "z", name: "search_handbook", args: { query: "pay" } }], deps, log);
    expect(deps.respond).not.toHaveBeenCalled();
  });
});
