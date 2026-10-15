import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
export type Pool = pg.Pool; export type PoolClient = pg.PoolClient;
export function createPool(url: string): Pool { return new pg.Pool({ connectionString: url, max: 10 }); }
export async function migrate(pool: Pool): Promise<void> {
  const sql = readFileSync(fileURLToPath(new URL("./schema.sql", import.meta.url)), "utf8");
  await pool.query(sql);
}
export async function withTx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query("begin"); const r = await fn(c); await c.query("commit"); return r; }
  catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
}
