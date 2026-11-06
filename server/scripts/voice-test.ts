/**
 * Manual check for Chunk 8: plays the part of the Flutter app.
 * Streams a spoken question (WAV) to /ws/voice-agent in real time, prints
 * the live transcripts, and saves the spoken reply as reply.wav.
 * The server must be running (npm run dev).
 *
 *   npx tsx scripts/voice-test.ts fixtures/question-sick-days.wav
 *   afplay reply.wav
 */
import { readFile, writeFile } from "node:fs/promises";
import WebSocket from "ws";
import { readWav, writeWav } from "./wav.js";

const file = process.argv[2];
const url = process.argv[3] ?? "ws://localhost:3000/ws/voice-agent";
if (!file) {
  console.error("Usage: npx tsx scripts/voice-test.ts <question.wav> [ws-url]");
  process.exit(1);
}

const wav = readWav(await readFile(file));
if (wav.sampleRate !== 16000 || wav.channels !== 1 || wav.bitsPerSample !== 16) {
  console.error(`Need 16 kHz mono 16-bit WAV, got ${wav.sampleRate} Hz, ${wav.channels} ch, ${wav.bitsPerSample}-bit`);
  console.error('Make one with: say -o q.wav --file-format=WAVE --data-format=LEI16@16000 "your question"');
  process.exit(1);
}

const CHUNK_MS = 100;
const CHUNK_BYTES = (16000 * 2 * CHUNK_MS) / 1000; // 100 ms of 16 kHz 16-bit audio = 3200 bytes
const replyAudio: Buffer[] = [];
const transcript = { user: "", model: "" };
const started = Date.now();
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;

const ws = new WebSocket(url);
const sendJson = (m: object) => ws.send(JSON.stringify(m));

// Give up if nothing finishes within 60 s.
const timeout = setTimeout(() => finish("timed out"), 60_000);

ws.on("message", async (raw) => {
  const msg = JSON.parse(raw.toString());
  switch (msg.type) {
    case "ready":
      console.log(`[${elapsed()}] ready, streaming ${(wav.samples.length / 32000).toFixed(1)}s of audio...`);
      await streamQuestion();
      break;
    case "audio":
      if (replyAudio.length === 0) console.log(`[${elapsed()}] first reply audio arrived`);
      replyAudio.push(Buffer.from(msg.data, "base64"));
      break;
    case "transcript":
      transcript[msg.role as "user" | "model"] += msg.text;
      break;
    case "tool":
      console.log(`[${elapsed()}] tool: ${msg.name} "${msg.query}"`);
      break;
    case "turn_complete":
      await finish("turn complete");
      break;
    case "error":
      console.log(`[${elapsed()}] error: ${msg.code} - ${msg.message}`);
      break;
    default:
      console.log(`[${elapsed()}]`, msg);
  }
});
ws.on("close", (code, reason) => finish(`socket closed (${code} ${reason})`));
ws.on("error", (err) => finish(`socket error: ${err.message}`));

/** Sends the question in 100 ms slices at real-time speed, like a live mic. */
async function streamQuestion() {
  for (let i = 0; i < wav.samples.length; i += CHUNK_BYTES) {
    sendJson({ type: "audio", data: wav.samples.subarray(i, i + CHUNK_BYTES).toString("base64") });
    await new Promise((r) => setTimeout(r, CHUNK_MS));
  }
  sendJson({ type: "end" }); // "mic released"
  console.log(`[${elapsed()}] question sent`);
}

let finished = false;
async function finish(reason: string) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  console.log(`[${elapsed()}] done: ${reason}\n`);
  console.log(`You said:    ${transcript.user.trim() || "(no transcript)"}`);
  console.log(`Agent said:  ${transcript.model.trim() || "(no transcript)"}`);
  if (replyAudio.length) {
    const pcm = Buffer.concat(replyAudio);
    await writeFile("reply.wav", writeWav(pcm, 24000)); // Gemini replies at 24 kHz
    console.log(`\nSaved reply.wav (${(pcm.length / 48000).toFixed(1)}s). Play it with: afplay reply.wav`);
  }
  ws.close();
  process.exit(0);
}
