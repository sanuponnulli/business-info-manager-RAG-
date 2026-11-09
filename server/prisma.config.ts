import { defineConfig, env } from "prisma/config";

// Prisma 7 no longer reads .env by itself; Node can (v21+).
try {
  process.loadEnvFile(".env");
} catch {
  // No .env file: rely on variables already set in the environment.
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
