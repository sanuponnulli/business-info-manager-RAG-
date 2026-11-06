import type { RequestHandler } from "express";
import { z } from "zod";
import { HttpError } from "../lib/httpError.js";
import { answerQuestion } from "../services/answer.service.js";

/** Limits keep one request from sending Gemini a huge (and costly) prompt. */
const AskBody = z.object({
  question: z.string().trim().min(1, "question is required").max(2000, "question is too long"),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "model"]),
        text: z.string().max(4000),
      }),
    )
    .max(20, "send at most the last 20 turns of history")
    .default([]),
});

/** POST /api/v1/chat/ask  { question, history? } → { answer, sources } */
export const ask: RequestHandler = async (req, res) => {
  const body = AskBody.safeParse(req.body);
  if (!body.success) {
    throw new HttpError(400, "invalid_body", body.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  }
  res.json(await answerQuestion(body.data.question, body.data.history));
};
