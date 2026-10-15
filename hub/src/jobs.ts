import type { Pool } from "./db.js";
import type { Config } from "./config.js";
import type { JobSink } from "./threads.js";
import { withTx } from "./db.js";

// Задание «ответь в ветке»; на одну пару (ветка, участник) — не больше одного незавершённого
export const enqueueJob = (pool: Pool): JobSink => async (threadId, memberId) => {
  await pool.query(`insert into jobs(thread_id,member_id) select $1,$2
    where not exists (select 1 from jobs where thread_id=$1 and member_id=$2 and status in ('queued','running'))`, [threadId, memberId]);
};

// Следующее задание участнику: строго по одному и не чаще maxRunsPerHour запусков в час.
// Блокировка по участнику — чтобы два одновременных вызова не выдали два задания сразу.
export async function nextJobFor(pool: Pool, cfg: Config, memberId: number) {
  return withTx(pool, async (c) => {
    await c.query("select pg_advisory_xact_lock(42, $1)", [memberId]);
    const busy = await c.query("select 1 from jobs where member_id=$1 and status='running'", [memberId]);
    if (busy.rowCount) return null;
    const runs = (await c.query("select count(*)::int n from jobs where member_id=$1 and started_at > now()-interval '1 hour'", [memberId])).rows[0].n;
    if (runs >= cfg.maxRunsPerHour) return null;
    const r = await c.query(`update jobs set status='running', started_at=now(), attempts=attempts+1
      where id=(select id from jobs where member_id=$1 and status='queued' order by id limit 1)
      returning id, thread_id`, [memberId]);
    return r.rows[0] ? { jobId: r.rows[0].id as number, threadId: r.rows[0].thread_id as number } : null;
  });
}

export async function finishJob(pool: Pool, jobId: number, ok: boolean, error?: string) {
  const r = await pool.query("update jobs set status=$2, error=$3, finished_at=now() where id=$1 and status='running' returning id",
    [jobId, ok ? "done" : "failed", error ?? null]);
  if (!ok && r.rowCount) await failNote(pool, jobId, error ?? "неизвестная ошибка");
}

async function failNote(pool: Pool, jobId: number, error: string) {
  const j = (await pool.query("select j.thread_id, j.member_id, m.short_name from jobs j join members m on m.id=j.member_id where j.id=$1", [jobId])).rows[0];
  await pool.query("insert into messages(thread_id,author_id,text) values($1,$2,$3)",
    [j.thread_id, j.member_id, `[система] агент ${j.short_name} не смог ответить: ${error}`]);
}

// running → снова в очередь, пока есть попытки; иначе failed и сообщение в ветку
async function retryOrFail(pool: Pool, cfg: Config, where: string, params: unknown[], reason: string) {
  const r = await pool.query(`select id, attempts from jobs where status='running' and ${where}`, params);
  for (const j of r.rows) {
    if (j.attempts < cfg.maxAttempts) await pool.query("update jobs set status='queued', started_at=null where id=$1", [j.id]);
    else {
      await pool.query("update jobs set status='failed', error=$2, finished_at=now() where id=$1", [j.id, reason]);
      await failNote(pool, j.id, reason);
    }
  }
}
export const requeueRunning = (pool: Pool, cfg: Config, memberId: number) =>
  retryOrFail(pool, cfg, "member_id=$1", [memberId], "ответчик отключился");
export const expireStale = (pool: Pool, cfg: Config) =>
  retryOrFail(pool, cfg, "started_at < now() - ($1::int * interval '1 millisecond')", [cfg.jobTimeoutMs], "превышено время ответа");
