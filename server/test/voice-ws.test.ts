import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import type { LiveBridgeHandlers } from "../src/ws/liveSession.js";

// A fake Gemini bridge: records what voiceAgent sends to "Gemini" and lets
// each test play Gemini's part by calling the handlers itself.
const fake = {
  handlers: null as LiveBridgeHandlers | null,
  sent: [] as unknown[],
  closed: false,
  failToOpen: false,
};
vi.mock("../src/ws/liveSession.js", () => ({
  openLiveBridge: vi.fn(async (handlers: LiveBridgeHandlers) => {
    if (fake.failToOpen) throw new Error("Gemini down");
    fake.handlers = handlers;
    setTimeout(() => handlers.onReady(), 5); // Gemini "setupComplete" shortly after connecting
    return {
      sendAudio: (data: string) => fake.sent.push({ audio: data }),
      sendText: (text: string) => fake.sent.push({ text }),
      endAudio: () => fake.sent.push({ end: true }),
      close: () => (fake.closed = true),
    };
  }),
}));

import { attachVoiceAgent, VOICE_PATH } from "../src/ws/voiceAgent.js";

let server: http.Server;
let base: string;

beforeAll(async () => {
  server = http.createServer();
  attachVoiceAgent(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `ws://localhost:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => Object.assign(fake, { handlers: null, sent: [], closed: false, failToOpen: false }));

/** Opens a socket and collects every message it receives. */
async function connect() {
  const ws = new WebSocket(base + VOICE_PATH);
  const received: Record<string, unknown>[] = [];
  ws.on("message", (data) => received.push(JSON.parse(data.toString())));
  await new Promise((resolve, reject) => ws.once("open", resolve).once("error", reject));
  const waitFor = async (count: number) => {
    await expect.poll(() => received.length).toBeGreaterThanOrEqual(count);
    return received;
  };
  return { ws, received, waitFor };
}

describe("voice WebSocket ↔ Gemini bridge", () => {
  it("says ready once Gemini is set up", async () => {
    const { ws, waitFor } = await connect();
    expect((await waitFor(1))[0]).toEqual({ type: "ready" });
    ws.close();
  });

  it("forwards audio, text and end to Gemini", async () => {
    const { ws, waitFor } = await connect();
    await waitFor(1);
    ws.send(JSON.stringify({ type: "audio", data: "AQIDBA==" }));
    ws.send(JSON.stringify({ type: "text", text: "hi" }));
    ws.send(JSON.stringify({ type: "end" }));
    await expect.poll(() => fake.sent).toEqual([{ audio: "AQIDBA==" }, { text: "hi" }, { end: true }]);
    ws.close();
  });

  it("forwards Gemini's messages to the client", async () => {
    const { ws, waitFor } = await connect();
    await waitFor(1);
    fake.handlers!.onMessage({ type: "transcript", role: "model", text: "Hello" });
    fake.handlers!.onMessage({ type: "turn_complete" });
    const msgs = await waitFor(3);
    expect(msgs.slice(1)).toEqual([{ type: "transcript", role: "model", text: "Hello" }, { type: "turn_complete" }]);
    ws.close();
  });

  it("closes the Gemini session when the client disconnects", async () => {
    const { ws, waitFor } = await connect();
    await waitFor(1);
    ws.close();
    await expect.poll(() => fake.closed).toBe(true);
  });

  it("closes the client when Gemini ends the session", async () => {
    const { ws, waitFor } = await connect();
    await waitFor(1);
    const closed = new Promise<number>((resolve) => ws.once("close", resolve));
    fake.handlers!.onClose("quota exceeded");
    const msgs = await waitFor(2);
    expect(msgs[1]).toMatchObject({ type: "error", code: "session_closed", message: "quota exceeded" });
    expect(await closed).toBe(1011);
  });

  it("tells the client when Gemini can't be reached", async () => {
    fake.failToOpen = true;
    const { ws, waitFor } = await connect();
    const closed = new Promise<number>((resolve) => ws.once("close", resolve));
    expect((await waitFor(1))[0]).toMatchObject({ type: "error", code: "upstream_unavailable" });
    expect(await closed).toBe(1011);
  });

  it("rejects bad messages without closing the socket", async () => {
    const { ws, waitFor } = await connect();
    await waitFor(1);
    ws.send("not json");
    ws.send(JSON.stringify({ type: "dance" }));
    const msgs = await waitFor(3);
    expect(msgs.slice(1).map((m) => m.code)).toEqual(["bad_message", "bad_message"]);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    expect(fake.sent).toEqual([]);
    ws.close();
  });

  it("refuses connections on any other path", async () => {
    const ws = new WebSocket(`${base}/ws/something-else`);
    const err = await new Promise<Error>((resolve) => ws.once("error", resolve));
    expect(err.message).toMatch(/404/);
  });
});
