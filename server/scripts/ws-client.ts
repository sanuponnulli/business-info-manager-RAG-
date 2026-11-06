/**
 * A minimal WebSocket client for poking at /ws/voice-agent by hand.
 * Each line you type is sent as one message; every reply is printed.
 * Audio replies are summarised instead of dumping base64.
 *
 *   npx tsx scripts/ws-client.ts
 *   > {"type":"text","text":"hi"}
 */
import readline from "node:readline";
import WebSocket from "ws";

const url = process.argv[2] ?? "ws://localhost:3000/ws/voice-agent";
const ws = new WebSocket(url);

ws.on("open", () => {
  console.log(`connected to ${url}; type JSON messages, Ctrl+C to quit`);
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", (line) => line.trim() && ws.send(line.trim()));
  rl.on("close", () => setTimeout(() => ws.close(), 1500)); // piped input: wait for last replies
});

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === "audio") console.log(`< audio (${Buffer.from(msg.data, "base64").length} bytes)`);
  else console.log("<", JSON.stringify(msg));
});

ws.on("close", (code) => {
  console.log(`closed (${code})`);
  process.exit(0);
});
ws.on("error", (err) => {
  console.error("error:", err.message);
  process.exit(1);
});
