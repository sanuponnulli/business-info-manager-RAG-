import http from "node:http";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { createApp } from "./app.js";

/**
 * Entry point. We create a plain Node http.Server and hand it the Express app.
 * Owning the http.Server ourselves (instead of calling app.listen) matters
 * later: the voice WebSocket in Chunk 8 attaches to this same server.
 */
const app = createApp();
const server = http.createServer(app);

server.listen(env.PORT, () => {
  logger.info(`Server listening on http://localhost:${env.PORT}`);
});
