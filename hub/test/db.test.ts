import { test, expect } from "vitest";
import { freshDb } from "./helpers.js";
import { migrate } from "../src/db.js";
test("схема применяется повторно без ошибок", async () => {
  const pool = await freshDb(); await migrate(pool);
  const r = await pool.query("select count(*)::int as n from information_schema.tables where table_schema='public' and table_name = any($1)",
    [["members","projects","member_projects","threads","thread_participants","messages","decisions","settings","invites","alerts","audit_log"]]);
  expect(r.rows[0].n).toBe(11); await pool.end();
});
