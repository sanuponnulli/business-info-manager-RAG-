import express from "express";
import { isChromaUp } from "./clients/chroma.js";
import { adminRouter } from "./routes/admin.routes.js";
import { chatRouter } from "./routes/chat.routes.js";
import { errorHandler, notFound } from "./middleware/error.js";

/**
 * Builds the Express app (routes + middleware) WITHOUT starting a server.
 * Keeping this separate from index.ts lets tests import the app and send
 * requests to it directly, without opening a real network port.
 */
export function createApp() {
  const app = express();

  app.use(express.json());

  // 200 when every dependency is reachable, 503 ("Service Unavailable") otherwise,
  // so a load balancer or uptime monitor can tell the server isn't really usable.
  app.get("/health", async (_req, res) => {
    const chroma = (await isChromaUp()) ? "ok" : "down";
    const healthy = chroma === "ok";
    res.status(healthy ? 200 : 503).json({ status: healthy ? "ok" : "degraded", chroma });
  });

  app.use("/api/v1/admin", adminRouter);
  app.use("/api/v1/chat", chatRouter);

  // These two must come last: they handle whatever the routes above didn't.
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
