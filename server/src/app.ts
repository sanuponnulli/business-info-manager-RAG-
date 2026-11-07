import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { isChromaUp } from "./clients/chroma.js";
import { adminRouter } from "./routes/admin.routes.js";
import { chatRouter } from "./routes/chat.routes.js";
import { errorHandler, notFound } from "./middleware/error.js";
import { requestLog } from "./middleware/requestLog.js";

/**
 * Builds the Express app (routes + middleware) WITHOUT starting a server.
 * Keeping this separate from index.ts lets tests import the app and send
 * requests to it directly, without opening a real network port.
 */
export function createApp() {
  const app = express();

  // Don't advertise "X-Powered-By: Express" to the world.
  app.disable("x-powered-by");

  app.use(requestLog);

  // Browsers block a web page from calling an API on another origin unless
  // the API allows it. This allows only the origins listed in CORS_ORIGINS
  // (the React admin app). Mobile apps and curl aren't affected by CORS.
  app.use(
    cors({
      origin: env.CORS_ORIGINS,
      allowedHeaders: ["Content-Type", "x-admin-key"],
      exposedHeaders: ["Location"], // so the admin app can read the job URL after an upload
    }),
  );

  // JSON bodies are small questions; refuse anything bigger than 100 KB.
  app.use(express.json({ limit: "100kb" }));

  // 200 when every dependency is reachable, 503 ("Service Unavailable") otherwise,
  // so a load balancer or uptime monitor can tell the server isn't really usable.
  app.get("/health", async (_req, res) => {
    const chroma = (await isChromaUp()) ? "ok" : "down";
    const healthy = chroma === "ok";
    // Always a fresh answer: a cached "ok" would hide an outage.
    res.set("Cache-Control", "no-store");
    res.status(healthy ? 200 : 503).json({ status: healthy ? "ok" : "degraded", chroma });
  });

  app.use("/api/v1/admin", adminRouter);
  app.use("/api/v1/chat", chatRouter);

  // These two must come last: they handle whatever the routes above didn't.
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
