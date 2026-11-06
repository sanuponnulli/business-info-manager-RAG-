import { Router } from "express";
import * as chat from "../controllers/chat.controller.js";

/** User-facing chat routes. Mounted at /api/v1/chat in app.ts. No auth yet (see plan). */
export const chatRouter = Router();

chatRouter.post("/ask", chat.ask);
