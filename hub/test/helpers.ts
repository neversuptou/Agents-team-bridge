import { createPool, migrate, type Pool } from "../src/db.js";
import { loadConfig } from "../src/config.js";
import { createInvite, register, bootstrapInvite } from "../src/members.js";
// база тестов — TB_DATABASE_URL (если задан), остальное — значения по умолчанию
export const testConfig = { ...loadConfig({ TB_DATABASE_URL: process.env.TB_DATABASE_URL }), salt: "test-salt", maxTurns: 10, maxMessagesPerHour: 30 };
export async function freshDb(): Promise<Pool> {
  const pool = createPool(testConfig.databaseUrl);
  await pool.query("drop schema public cascade; create schema public;");
  await migrate(pool);
  return pool;
}
// Первый участник (админ) по стартовому приглашению, остальные — по приглашению от админа
export async function addMember(pool: Pool, shortName: string, admin?: { id: number }) {
  const invite = admin ? (await createInvite(pool, testConfig, admin.id, { fullName: shortName.toUpperCase() })).invite
    : (await bootstrapInvite(pool, testConfig))!;
  return register(pool, testConfig, { invite, shortName });
}
