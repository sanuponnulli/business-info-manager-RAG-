import express from "express";
import { isChromaUp } from "./clients/chroma.js";

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

  return app;
}
