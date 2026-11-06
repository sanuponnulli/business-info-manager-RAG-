import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { logger } from "../lib/logger.js";
import { parseClientMessage, type ClientMessage, type ServerMessage } from "./protocol.js";

export const VOICE_PATH = "/ws/voice-agent";

/** Largest frame we accept. Audio is sent in small slices, so 1 MB is generous. */
const MAX_FRAME_BYTES = 1024 * 1024;

/**
 * Attaches the voice WebSocket to the existing HTTP server, so REST and
 * WebSocket share one port (see index.ts).
 *
 * `noServer: true` means the ws library doesn't listen on its own; we hand
 * it only the upgrade requests for VOICE_PATH and refuse everything else.
 */
export function attachVoiceAgent(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    if (pathname !== VOICE_PATH) {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws) => handleConnection(ws));
  return wss;
}

/** Sends a typed message, ignoring sockets that have already closed. */
export function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function handleConnection(ws: WebSocket): void {
  const log = logger.child({ ws: Math.random().toString(36).slice(2, 8) });
  log.info("Voice client connected");

  // Chunk 8b replaces this echo with a Gemini Live session.
  send(ws, { type: "ready" });

  ws.on("message", (data, isBinary) => {
    if (isBinary) {
      send(ws, { type: "error", code: "bad_message", message: "Send JSON text frames, not binary" });
      return;
    }
    const parsed = parseClientMessage(data.toString());
    if (!parsed.ok) {
      send(ws, { type: "error", code: "bad_message", message: parsed.error });
      return;
    }
    handleClientMessage(ws, parsed.message);
  });

  ws.on("close", (code) => log.info({ code }, "Voice client disconnected"));
  ws.on("error", (err) => log.warn({ err }, "Voice socket error"));
}

/** Temporary echo for 8a: proves messages flow both ways. */
function handleClientMessage(ws: WebSocket, message: ClientMessage): void {
  switch (message.type) {
    case "text":
      send(ws, { type: "transcript", role: "model", text: `echo: ${message.text}` });
      break;
    case "audio":
      send(ws, { type: "audio", data: message.data }); // play the user's own audio back
      break;
    case "end":
      send(ws, { type: "turn_complete" });
      break;
  }
}
