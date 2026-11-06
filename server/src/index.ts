import http from "node:http";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { createApp } from "./app.js";
import { attachVoiceAgent, VOICE_PATH } from "./ws/voiceAgent.js";

/**
 * Entry point. We create a plain Node http.Server and hand it the Express app.
 * Owning the http.Server ourselves (instead of calling app.listen) lets the
 * voice WebSocket attach to this same server, so both share one port.
 */
const app = createApp();
const server = http.createServer(app);
const voice = attachVoiceAgent(server);

server.listen(env.PORT, () => {
  logger.info(`Server listening on http://localhost:${env.PORT}`);
  logger.info(`Voice WebSocket on ws://localhost:${env.PORT}${VOICE_PATH}`);
});

/**
 * Clean shutdown on Ctrl+C (SIGINT) or when a host like Docker/Kubernetes
 * stops us (SIGTERM): stop taking new requests, end every voice session
 * (which also closes their Gemini sessions), let in-flight HTTP requests
 * finish, then exit. If that takes over 10 s, exit anyway.
 *
 * Note: an ingestion job still running at this point is lost (the job queue
 * lives in memory); the previously stored version of that document stays intact.
 */
let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Shutting down");

  voice.closeAll();
  server.close(() => {
    logger.info("Shutdown complete");
    process.exit(0);
  });
  server.closeIdleConnections(); // drop keep-alive connections that aren't mid-request

  setTimeout(() => {
    logger.warn("Shutdown timed out, forcing exit");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
