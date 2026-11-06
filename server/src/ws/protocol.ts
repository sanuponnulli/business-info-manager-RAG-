import { z } from "zod";

/**
 * The message "contract" between the Flutter app and /ws/voice-agent.
 * Every WebSocket frame is one JSON object with a `type` field.
 * The React/Flutter developers only need this file to know what to send
 * and what to expect back.
 */

// --- Client → server -------------------------------------------------------

export const ClientMessage = z.discriminatedUnion("type", [
  /** A slice of microphone audio: base64 of raw PCM16, 16 kHz, mono. */
  z.object({ type: z.literal("audio"), data: z.base64() }),
  /** A typed message, for when the user types instead of speaking. */
  z.object({ type: z.literal("text"), text: z.string().trim().min(1).max(2000) }),
  /** The user stopped talking (e.g. released the mic button). */
  z.object({ type: z.literal("end") }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

// --- Server → client -------------------------------------------------------

export type ServerMessage =
  /** The session is open; the client may start sending. */
  | { type: "ready" }
  /** A slice of the spoken reply: base64 of raw PCM16, 24 kHz, mono. */
  | { type: "audio"; data: string }
  /** Text of what was said, for captions. Arrives in fragments: append them until turn_complete. */
  | { type: "transcript"; role: "user" | "model"; text: string }
  /** The agent is searching the handbook (so the app can show "Searching…"). */
  | { type: "tool"; name: string; query: string }
  /** The user talked over the agent: stop playing any queued audio. */
  | { type: "interrupted" }
  /** The agent finished its reply. */
  | { type: "turn_complete" }
  | { type: "error"; code: string; message: string };

/**
 * Parses one incoming frame. Returns either the typed message or a
 * human-readable reason it was rejected.
 */
export function parseClientMessage(raw: string): { ok: true; message: ClientMessage } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Message is not valid JSON" };
  }
  const result = ClientMessage.safeParse(json);
  if (!result.success) {
    return { ok: false, error: result.error.issues.map((i) => `${i.path.join(".") || "message"}: ${i.message}`).join("; ") };
  }
  return { ok: true, message: result.data };
}
