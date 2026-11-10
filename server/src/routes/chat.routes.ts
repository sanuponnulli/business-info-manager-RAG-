import { Router } from "express";
import * as chat from "../controllers/chat.controller.js";
import { optionalUser } from "../middleware/userAuth.js";

/**
 * User-facing chat routes. Mounted at /api/v1/chat in app.ts.
 * Sign-in is optional: anonymous users get handbook answers only; with a
 * bearer token the assistant can also use the HR tools their role allows.
 */
export const chatRouter = Router();

chatRouter.post("/ask", optionalUser, chat.ask);
