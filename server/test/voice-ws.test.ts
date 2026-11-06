import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import { attachVoiceAgent, VOICE_PATH } from "../src/ws/voiceAgent.js";

// A real HTTP server on a random free port (port 0), with only the WebSocket attached.
let server: http.Server;
let base: string;

beforeAll(async () => {
  server = http.createServer();
  attachVoiceAgent(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `ws://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

/** Opens a socket and collects every message it receives. */
async function connect() {
  const ws = new WebSocket(base + VOICE_PATH);
  const received: Record<string, unknown>[] = [];
  ws.on("message", (data) => received.push(JSON.parse(data.toString())));
  await new Promise((resolve, reject) => ws.once("open", resolve).once("error", reject));
  /** Waits until `count` messages have arrived. */
  const waitFor = async (count: number) => {
    await expect.poll(() => received.length).toBeGreaterThanOrEqual(count);
    return received;
  };
  return { ws, waitFor };
}

describe("voice WebSocket (8a echo)", () => {
  it("says ready on connect", async () => {
    const { ws, waitFor } = await connect();
    expect((await waitFor(1))[0]).toEqual({ type: "ready" });
    ws.close();
  });

  it("echoes a text message", async () => {
    const { ws, waitFor } = await connect();
    ws.send(JSON.stringify({ type: "text", text: "hi" }));
    expect((await waitFor(2))[1]).toEqual({ type: "transcript", role: "model", text: "echo: hi" });
    ws.close();
  });

  it("echoes audio and ends the turn", async () => {
    const { ws, waitFor } = await connect();
    const data = Buffer.from([1, 2, 3, 4]).toString("base64");
    ws.send(JSON.stringify({ type: "audio", data }));
    ws.send(JSON.stringify({ type: "end" }));
    const msgs = await waitFor(3);
    expect(msgs[1]).toEqual({ type: "audio", data });
    expect(msgs[2]).toEqual({ type: "turn_complete" });
    ws.close();
  });

  it("rejects bad messages without closing the socket", async () => {
    const { ws, waitFor } = await connect();
    ws.send("not json");
    ws.send(JSON.stringify({ type: "dance" }));
    ws.send(JSON.stringify({ type: "audio", data: "%%% not base64 %%%" }));
    const msgs = await waitFor(4);
    expect(msgs.slice(1).map((m) => m.type)).toEqual(["error", "error", "error"]);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it("refuses connections on any other path", async () => {
    const ws = new WebSocket(`${base}/ws/something-else`);
    const err = await new Promise<Error>((resolve) => ws.once("error", resolve));
    expect(err.message).toMatch(/404/);
  });
});
