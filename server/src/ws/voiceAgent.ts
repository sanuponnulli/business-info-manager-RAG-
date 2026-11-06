import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { logger } from "../lib/logger.js";
import { parseClientMessage, type ClientMessage, type ServerMessage } from "./protocol.js";
import { openLiveBridge, type LiveBridge } from "./liveSession.js";

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

  wss.on("connection", (ws) => void handleConnection(ws));
  return wss;
}

/** Sends a typed message, ignoring sockets that have already closed. */
export function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

/**
 * One client connection = one Gemini Live session. This function wires the
 * two together and makes sure that when either side goes away, the other
 * is closed too (no orphaned Gemini sessions costing money).
 */
async function handleConnection(ws: WebSocket): Promise<void> {
  const log = logger.child({ ws: Math.random().toString(36).slice(2, 8) });
  log.info("Voice client connected");

  let bridge: LiveBridge | null = null;
  let ready = false;

  // Register client listeners first, so nothing sent during setup is lost.
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
    if (!bridge || !ready) {
      send(ws, { type: "error", code: "not_ready", message: 'Wait for {"type":"ready"} before sending' });
      return;
    }
    forwardToGemini(bridge, parsed.message);
  });

  ws.on("close", (code) => {
    log.info({ code }, "Voice client disconnected");
    bridge?.close(); // client left → end the Gemini session
  });
  ws.on("error", (err) => log.warn({ err }, "Voice socket error"));

  try {
    bridge = await openLiveBridge(
      {
        onReady: () => {
          ready = true;
          send(ws, { type: "ready" });
        },
        onMessage: (message) => send(ws, message),
        onClose: (reason) => {
          // Gemini left → tell the client why, then hang up.
          log.warn({ reason }, "Gemini Live session closed");
          send(ws, { type: "error", code: "session_closed", message: reason });
          ws.close(1011, "Voice session ended");
        },
      },
      log,
    );
    // The client may have hung up while we were still connecting.
    if (ws.readyState !== WebSocket.OPEN) bridge.close();
  } catch (err) {
    log.error({ err }, "Could not open Gemini Live session");
    send(ws, { type: "error", code: "upstream_unavailable", message: "Voice service is unavailable, try again later" });
    ws.close(1011, "Voice service unavailable");
  }
}

/** Our protocol message → the matching Gemini call. */
function forwardToGemini(bridge: LiveBridge, message: ClientMessage): void {
  switch (message.type) {
    case "audio":
      bridge.sendAudio(message.data);
      break;
    case "text":
      bridge.sendText(message.text);
      break;
    case "end":
      bridge.endAudio();
      break;
  }
}
