import { env } from "../config/env.js";
import { createPrisma } from "./db.js";

/**
 * The one Prisma client the server uses. It holds a connection pool, so the
 * whole app shares a single instance. Creating it doesn't connect yet: the
 * first query does.
 */
export const prisma = createPrisma(env.DATABASE_URL);
