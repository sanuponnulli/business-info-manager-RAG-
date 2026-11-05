import { z } from "zod";

/**
 * All configuration lives here. Every value is read from process.env once,
 * validated, and exported as a typed object. If anything is missing or
 * malformed, the server refuses to start ("fail fast") instead of crashing
 * later in the middle of a request.
 */
const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["silent", "fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  GEMINI_API_KEY: z.string({ error: "is required" }).min(1, "is required"),
  ADMIN_API_KEY: z.string({ error: "is required" }).min(16, "must be at least 16 characters"),

  CHROMA_URL: z.string().url().default("http://localhost:8000"),
  CHROMA_COLLECTION: z.string().min(1).default("handbook-collection"),

  EMBEDDING_MODEL: z.string().default("gemini-embedding-001"),
  CHAT_MODEL: z.string().default("gemini-2.5-flash"),
  LIVE_MODEL: z.string().default("gemini-2.5-flash-native-audio-preview-12-2025"),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    console.error(`\nInvalid environment configuration:\n${problems}\n\nCheck your server/.env file (see .env.example).\n`);
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
