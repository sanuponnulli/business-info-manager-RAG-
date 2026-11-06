import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { parseClientMessage, type ClientMessage, type ServerMessage } from "./protocol.js";
import { openLiveBridge, type LiveBridge } from "./liveSession.js";

export const VOICE_PATH = "/ws/voice-agent";

/** Largest frame we accept. Audio is sent in small slices, so 1 MB is generous. */
const MAX_FRAME_BYTES = 1024 * 1024;

/** WebSocket close codes we use (RFC 6455 numbers). */
const CLOSE = {
  normal: 1000,
  goingAway: 1001, // server shutting down
  serverError: 1011, // Gemini failed or left
  tryAgainLater: 1013, // too many sessions
} as const;

export interface VoiceAgentOptions {
  /** Most simultaneous voice sessions; each holds a paid Gemini Live connection. */
  maxSessions?: number;
  /** Close a session after this long with no audio/text in either direction. */
  idleTimeoutMs?: number;
  /** How often to ping clients to detect dead connections (e.g. phone lost signal). */
  heartbeatMs?: number;
}

export interface VoiceAgent {
  wss: WebSocketServer;
  /** Closes every session (used on shutdown). */
  closeAll: () => void;
}

/**
 * Attaches the voice WebSocket to the existing HTTP server, so REST and
 * WebSocket share one port (see index.ts).
 *
 * `noServer: true` means the ws library doesn't listen on its own; we hand
 * it only the upgrade requests for VOICE_PATH and refuse everything else.
 */
export function attachVoiceAgent(server: Server, options: VoiceAgentOptions = {}): VoiceAgent {
  const {
    maxSessions = env.VOICE_MAX_SESSIONS,
    idleTimeoutMs = env.VOICE_IDLE_TIMEOUT_MS,
    heartbeatMs = 30_000,
  } = options;
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

  wss.on("connection", (ws) => {
    // wss.clients already includes this new socket, hence ">".
    if (wss.clients.size > maxSessions) {
      logger.warn({ maxSessions }, "Voice session refused: at capacity");
      send(ws, { type: "error", code: "server_busy", message: "Too many voice sessions right now, try again shortly" });
      ws.close(CLOSE.tryAgainLater, "Server busy");
      return;
    }
    void handleConnection(ws, idleTimeoutMs);
  });

  // Heartbeat: ping every client; one that hasn't answered the previous ping
  // is dead (no clean close ever arrived), so drop it and free its Gemini session.
  const alive = new WeakMap<WebSocket, boolean>();
  wss.on("connection", (ws) => {
    alive.set(ws, true);
    ws.on("pong", () => alive.set(ws, true));
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, heartbeatMs);
  heartbeat.unref(); // don't keep the process alive just for this timer
  wss.on("close", () => clearInterval(heartbeat));

  return {
    wss,
    closeAll: () => {
      for (const ws of wss.clients) ws.close(CLOSE.goingAway, "Server shutting down");
      wss.close();
    },
  };
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
async function handleConnection(ws: WebSocket, idleTimeoutMs: number): Promise<void> {
  const log = logger.child({ ws: Math.random().toString(36).slice(2, 8) });
  log.info("Voice client connected");

  let bridge: LiveBridge | null = null;
  let ready = false;

  // Idle timeout: restarted by any traffic in either direction.
  let idleTimer: NodeJS.Timeout | undefined;
  const touch = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      log.info({ idleTimeoutMs }, "Voice session idle, closing");
      send(ws, { type: "error", code: "idle_timeout", message: "Closed after a period of inactivity" });
      ws.close(CLOSE.normal, "Idle timeout");
    }, idleTimeoutMs);
  };
  touch();

  // Register client listeners first, so nothing sent during setup is lost.
  ws.on("message", (data, isBinary) => {
    touch();
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
    clearTimeout(idleTimer);
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
        onMessage: (message) => {
          touch(); // the agent talking counts as activity
          send(ws, message);
        },
        onClose: (reason) => {
          // Gemini left → tell the client why, then hang up.
          log.warn({ reason }, "Gemini Live session closed");
          send(ws, { type: "error", code: "session_closed", message: reason });
          ws.close(CLOSE.serverError, "Voice session ended");
        },
      },
      log,
    );
    // The client may have hung up while we were still connecting.
    if (ws.readyState !== WebSocket.OPEN) bridge.close();
  } catch (err) {
    log.error({ err }, "Could not open Gemini Live session");
    send(ws, { type: "error", code: "upstream_unavailable", message: "Voice service is unavailable, try again later" });
    ws.close(CLOSE.serverError, "Voice service unavailable");
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
