import type { Pool, PoolClient } from "./db.js";
// Журнал только на добавление: кто, что, когда, кому. Текст сообщений сюда не пишется.
export async function audit(db: Pool | PoolClient, actorId: number | null, action: string, target?: string, details: object = {}) {
  await db.query("insert into audit_log(actor_id,action,target,details) values($1,$2,$3,$4)", [actorId, action, target ?? null, JSON.stringify(details)]);
}
