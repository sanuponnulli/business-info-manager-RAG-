import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * In development the browser only ever talks to Vite (localhost:5173).
 * Vite forwards API and WebSocket traffic to the backend on :3000, so the
 * app and the API look like one origin: no CORS problems, and the voice
 * WebSocket URL is simply "/ws/voice-agent".
 */
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": BACKEND,
      "/health": BACKEND,
      "/ws": { target: BACKEND, ws: true }, // ws: true forwards WebSocket upgrades too
    },
  },
});
