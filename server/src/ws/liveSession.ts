import { Modality, type LiveServerMessage, type Session } from "@google/genai";
import { gemini } from "../clients/gemini.js";
import { env } from "../config/env.js";
import type { Logger } from "pino";
import type { ServerMessage } from "./protocol.js";
import { todayString } from "../lib/dates.js";
import type { AuthUser } from "../middleware/userAuth.js";
import { voiceInstruction } from "../tools/instructions.js";
import { toolDeclarationsFor } from "../tools/registry.js";
import { runToolCalls } from "./tools.js";

/** Gemini Live expects raw 16-bit PCM at 16 kHz from the microphone. */
const INPUT_AUDIO_MIME = "audio/pcm;rate=16000";

/**
 * 1 second of silence (16000 samples × 2 bytes, all zero). Gemini decides
 * the user has finished speaking by hearing a pause. If the audio stops
 * abruptly on the last word, it can wait ~50 s before replying, so when the
 * client says "end" we add the pause ourselves.
 */
const TRAILING_SILENCE = Buffer.alloc(16000 * 2).toString("base64");

export interface LiveBridgeHandlers {
  /** Gemini is set up and ready to listen. */
  onReady: () => void;
  /** Something to forward to our client, already in our protocol's shape. */
  onMessage: (message: ServerMessage) => void;
  /** Gemini ended the session (error, timeout, or normal close). */
  onClose: (reason: string) => void;
}

/** What voiceAgent.ts can do with an open Gemini session. */
export interface LiveBridge {
  sendAudio: (base64Pcm: string) => void;
  sendText: (text: string) => void;
  endAudio: () => void;
  close: () => void;
}

/**
 * Opens one Gemini Live session for one connected client and translates
 * between Gemini's events and our own protocol (protocol.ts). The client
 * never talks to Gemini directly, so our API key never leaves the server.
 */
export async function openLiveBridge(handlers: LiveBridgeHandlers, log: Logger, user: AuthUser | null = null): Promise<LiveBridge> {
  let closed = false;
  // Calls Gemini has withdrawn (the user interrupted while we were searching).
  const cancelledCalls = new Set<string>();
  // Gemini ends its turn as soon as it ASKS for a tool, then answers in a new
  // turn once it has our results. To the client that's one reply, so we hold
  // back turn_complete until Gemini has actually started answering.
  let waitingForAnswerAfterTool = false;

  /** Gemini message → our protocol messages, plus answering tool calls. */
  const onGeminiMessage = (msg: LiveServerMessage) => {
    if (msg.setupComplete) handlers.onReady();

    const content = msg.serverContent;
    if (content) {
      // The spoken reply arrives as many small slices of 24 kHz PCM.
      for (const part of content.modelTurn?.parts ?? []) {
        if (part.inlineData?.data) {
          waitingForAnswerAfterTool = false; // the real answer has started
          handlers.onMessage({ type: "audio", data: part.inlineData.data });
        }
      }
      // Transcripts also arrive in fragments; the client appends them.
      if (content.inputTranscription?.text) {
        handlers.onMessage({ type: "transcript", role: "user", text: content.inputTranscription.text });
      }
      if (content.outputTranscription?.text) {
        handlers.onMessage({ type: "transcript", role: "model", text: content.outputTranscription.text });
      }
      if (content.interrupted) {
        waitingForAnswerAfterTool = false;
        handlers.onMessage({ type: "interrupted" });
      }
      if (content.turnComplete && !waitingForAnswerAfterTool) handlers.onMessage({ type: "turn_complete" });
    }

    // Gemini wants us to run a tool (handbook search, leave balance, ...) as this user. It waits (silently) for our answer.
    if (msg.toolCall?.functionCalls?.length) {
      waitingForAnswerAfterTool = true;
      void runToolCalls(
        msg.toolCall.functionCalls,
        {
          notify: (name, query) => handlers.onMessage({ type: "tool", name, query }),
          respond: (functionResponses) => {
            if (!closed) session.sendToolResponse({ functionResponses });
          },
          isCancelled: (id) => cancelledCalls.has(id),
        },
        log,
        { user, today: todayString() },
      );
    }
    for (const id of msg.toolCallCancellation?.ids ?? []) cancelledCalls.add(id);

    // Gemini warns shortly before it ends a long session.
    if (msg.goAway) log.info({ timeLeft: msg.goAway.timeLeft }, "Gemini Live will close the session soon");
  };

  const session: Session = await gemini.live.connect({
    model: env.LIVE_MODEL,
    config: {
      responseModalities: [Modality.AUDIO], // reply with speech
      // Both depend on who's signed in: not signed in = handbook only.
      systemInstruction: voiceInstruction(user, todayString()),
      tools: [{ functionDeclarations: toolDeclarationsFor(user) }],
      inputAudioTranscription: {}, // also send us text of what the user said...
      outputAudioTranscription: {}, // ...and of what the model said (for captions)
    },
    callbacks: {
      onmessage: onGeminiMessage,
      onerror: (e) => log.warn({ err: e.message }, "Gemini Live error"),
      onclose: (e) => {
        if (closed) return; // we closed it ourselves; nothing to report
        closed = true;
        handlers.onClose(e.reason || `Gemini closed the session (code ${e.code})`);
      },
    },
  });

  return {
    sendAudio: (data) => session.sendRealtimeInput({ audio: { data, mimeType: INPUT_AUDIO_MIME } }),
    sendText: (text) => session.sendRealtimeInput({ text }),
    // The mic was released: send the pause Gemini listens for, then mark the stream ended.
    endAudio: () => {
      session.sendRealtimeInput({ audio: { data: TRAILING_SILENCE, mimeType: INPUT_AUDIO_MIME } });
      session.sendRealtimeInput({ audioStreamEnd: true });
    },
    close: () => {
      if (closed) return;
      closed = true;
      session.close();
    },
  };
}
