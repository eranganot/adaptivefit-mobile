import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

type DB = ReturnType<typeof drizzle<typeof schema>>;

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __db: DB | undefined;
}

function getPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
  }
  if (!global.__pgPool) {
    global.__pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
    });
  }
  return global.__pgPool;
}

// Lazy singleton — created on first db call, not at module import time.
// This allows Next.js to safely import this module during the build phase
// when DATABASE_URL is not yet available.
export const db: DB = new Proxy({} as DB, {
  get(_, prop) {
    if (!global.__db) {
      global.__db = drizzle(getPool(), { schema });
    }
    return Reflect.get(global.__db, prop as string);
  },
});

export { schema };
