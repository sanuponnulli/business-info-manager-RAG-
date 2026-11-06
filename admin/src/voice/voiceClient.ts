/**
 * The voice WebSocket protocol, as seen from the browser. These types
 * mirror server/src/ws/protocol.ts; see server/README.md for the details.
 */

export type ClientMessage =
  | { type: "audio"; data: string } // base64 PCM16, 16 kHz, mono
  | { type: "text"; text: string }
  | { type: "end" };

export type ServerMessage =
  | { type: "ready" }
  | { type: "audio"; data: string } // base64 PCM16, 24 kHz, mono
  | { type: "transcript"; role: "user" | "model"; text: string }
  | { type: "tool"; name: string; query: string }
  | { type: "interrupted" }
  | { type: "turn_complete" }
  | { type: "error"; code: string; message: string };

export interface VoiceClientHandlers {
  onMessage: (msg: ServerMessage) => void;
  onClose: (code: number, reason: string) => void;
}

/** Same host as the page (Vite forwards /ws to the backend), ws:// or wss:// to match http/https. */
export function voiceUrl(): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}/ws/voice-agent`;
}

/** A thin typed wrapper around one WebSocket connection. */
export class VoiceClient {
  private readonly ws: WebSocket;

  constructor(handlers: VoiceClientHandlers, url = voiceUrl()) {
    this.ws = new WebSocket(url);
    this.ws.onmessage = (e) => handlers.onMessage(JSON.parse(e.data as string) as ServerMessage);
    this.ws.onclose = (e) => handlers.onClose(e.code, e.reason);
  }

  send(msg: ClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.ws.close(1000, "Closed by user");
  }
}
