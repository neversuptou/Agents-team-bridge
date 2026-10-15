import { createPool, migrate, type Pool } from "../src/db.js";
import { loadConfig } from "../src/config.js";
export const testConfig = { ...loadConfig(), salt: "test-salt", maxTurns: 10, maxRunsPerHour: 6, jobTimeoutMs: 1000, maxAttempts: 2 };
export async function freshDb(): Promise<Pool> {
  const pool = createPool(testConfig.databaseUrl);
  await pool.query("drop schema public cascade; create schema public;");
  await migrate(pool);
  return pool;
}
