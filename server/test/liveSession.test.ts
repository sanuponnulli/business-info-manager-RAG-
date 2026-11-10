import { describe, it, expect, vi, beforeEach } from "vitest";
import { pino } from "pino";
import type { LiveCallbacks, LiveServerMessage } from "@google/genai";

// A fake Gemini Live: captures the callbacks so each test can play Gemini.
const fakeSession = { sendRealtimeInput: vi.fn(), sendToolResponse: vi.fn(), close: vi.fn() };
let callbacks: LiveCallbacks;
let connectConfig: Record<string, unknown>;
vi.mock("../src/clients/gemini.js", () => ({
  gemini: {
    live: {
      connect: vi.fn(async (params: { config: Record<string, unknown>; callbacks: LiveCallbacks }) => {
        callbacks = params.callbacks;
        connectConfig = params.config;
        return fakeSession;
      }),
    },
  },
}));
vi.mock("../src/services/rag.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/services/rag.service.js")>()), // real formatContext
  retrieveContext: vi.fn(async () => ({
    chunks: [{ text: "Ten days of sick leave.", docId: "h", title: "Handbook", page: 2, score: 0.7 }],
    contextText: "",
  })),
}));

import { openLiveBridge } from "../src/ws/liveSession.js";
import type { ServerMessage } from "../src/ws/protocol.js";

const log = pino({ level: "silent" });
let sent: ServerMessage[];
const gemini = (msg: LiveServerMessage) => callbacks.onmessage(msg);

beforeEach(async () => {
  vi.clearAllMocks();
  sent = [];
  await openLiveBridge({ onReady: vi.fn(), onMessage: (m) => sent.push(m), onClose: vi.fn() }, log);
});

describe("openLiveBridge", () => {
  it("gives an anonymous caller only the search_handbook tool", () => {
    const tools = connectConfig.tools as { functionDeclarations: { name: string }[] }[];
    expect(tools[0].functionDeclarations.map((d) => d.name)).toEqual(["search_handbook"]);
    expect(connectConfig.systemInstruction).toMatch(/NOT signed in/);
  });

  it("gives a signed-in manager the HR tools too", async () => {
    await openLiveBridge({ onReady: vi.fn(), onMessage: vi.fn(), onClose: vi.fn() }, log, { id: 6, role: "MANAGER" });
    const names = (connectConfig.tools as { functionDeclarations: { name: string }[] }[])[0].functionDeclarations.map((d) => d.name);
    expect(names).toContain("get_my_leave_balances");
    expect(names).toContain("get_team_leave");
  });

  it("answers a tool call with the matching id and tells the client", async () => {
    gemini({ toolCall: { functionCalls: [{ id: "c1", name: "search_handbook", args: { query: "sick days" } }] } } as LiveServerMessage);

    await vi.waitFor(() => expect(fakeSession.sendToolResponse).toHaveBeenCalled());
    expect(fakeSession.sendToolResponse).toHaveBeenCalledWith({
      functionResponses: [{ id: "c1", name: "search_handbook", response: { result: "[1] (Handbook, p. 2)\nTen days of sick leave." } }],
    });
    expect(sent).toContainEqual({ type: "tool", name: "search_handbook", query: "sick days" });
  });

  it("hides the turn_complete Gemini sends while waiting for the search", () => {
    gemini({ toolCall: { functionCalls: [{ id: "c1", name: "search_handbook", args: { query: "x" } }] } } as LiveServerMessage);
    gemini({ serverContent: { turnComplete: true } } as LiveServerMessage); // ← premature
    gemini({ serverContent: { modelTurn: { parts: [{ inlineData: { data: "AAAA", mimeType: "audio/pcm" } }] } } } as LiveServerMessage);
    gemini({ serverContent: { turnComplete: true } } as LiveServerMessage); // ← the real end

    const types = sent.map((m) => m.type);
    expect(types.filter((t) => t === "turn_complete")).toHaveLength(1);
    expect(types.indexOf("audio")).toBeLessThan(types.indexOf("turn_complete"));
  });

  it("passes turn_complete straight through when no tool was used", () => {
    gemini({ serverContent: { turnComplete: true } } as LiveServerMessage);
    expect(sent).toEqual([{ type: "turn_complete" }]);
  });

  it("adds a second of silence before ending the audio stream", async () => {
    const bridge = await openLiveBridge({ onReady: vi.fn(), onMessage: vi.fn(), onClose: vi.fn() }, log);
    bridge.endAudio();
    const [silence, end] = fakeSession.sendRealtimeInput.mock.calls.map(([arg]) => arg);
    expect(Buffer.from(silence.audio.data, "base64")).toHaveLength(32000);
    expect(end).toEqual({ audioStreamEnd: true });
  });
});
