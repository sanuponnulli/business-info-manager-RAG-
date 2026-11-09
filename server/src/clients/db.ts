import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

/**
 * The HR database (Postgres, schema in prisma/schema.prisma).
 *
 * Prisma 7 talks to Postgres through a "driver adapter": the plain `pg`
 * driver does the networking, Prisma builds the queries and types.
 *
 * This file deliberately doesn't import config/env.ts, so the seed script can
 * use it without needing the Gemini and admin keys.
 */
export function createPrisma(connectionString = process.env.DATABASE_URL): PrismaClient {
  if (!connectionString) throw new Error("DATABASE_URL is not set (see server/.env.example)");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
