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
attachVoiceAgent(server);

server.listen(env.PORT, () => {
  logger.info(`Server listening on http://localhost:${env.PORT}`);
  logger.info(`Voice WebSocket on ws://localhost:${env.PORT}${VOICE_PATH}`);
});
