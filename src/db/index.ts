import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export const databaseConfigured = Boolean(process.env.DATABASE_URL);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://neximail:neximail@127.0.0.1:5432/neximail",
  connectionTimeoutMillis: 3000,
});

export const db = drizzle(pool, { schema });
