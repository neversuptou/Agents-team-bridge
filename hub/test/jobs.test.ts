import { beforeEach, afterEach, test, expect } from "vitest";
import { freshDb, testConfig } from "./helpers.js";
import { setInviteCode, register } from "../src/members.js";
import { ask } from "../src/threads.js";
import { enqueueJob, nextJobFor, finishJob, requeueRunning, expireStale } from "../src/jobs.js";
let pool: any, me: any, dima: any; const cfg = { ...testConfig, maxRunsPerHour: 2, maxAttempts: 2 };
beforeEach(async () => {
  pool = await freshDb(); await setInviteCode(pool, cfg, "c");
  me = (await register(pool, cfg, { inviteCode: "c", fullName: "А", shortName: "а" })).member;
  dima = (await register(pool, cfg, { inviteCode: "c", fullName: "Д", shortName: "д" })).member;
});
afterEach(async () => { await pool.end(); });
const q = async (n = 1) => { const out = []; for (let i = 0; i < n; i++) out.push(await ask(pool, cfg, enqueueJob(pool), me, { to: "д", subject: "s" + i, text: "q" }, new Set())); return out; };
test("по очереди: пока running — следующего нет", async () => {
  await q(2);
  const j1 = await nextJobFor(pool, cfg, dima.id); expect(j1).not.toBeNull();
  expect(await nextJobFor(pool, cfg, dima.id)).toBeNull();
  await finishJob(pool, j1!.jobId, true);
  expect(await nextJobFor(pool, cfg, dima.id)).not.toBeNull();
});
test("лимит запусков в час", async () => {
  await q(3);
  for (let i = 0; i < 2; i++) { const j = await nextJobFor(pool, cfg, dima.id); await finishJob(pool, j!.jobId, true); }
  expect(await nextJobFor(pool, cfg, dima.id)).toBeNull();
});
test("разрыв: повтор, затем failed с сообщением в ветке", async () => {
  const [{ threadId }] = await q(1);
  await nextJobFor(pool, cfg, dima.id); await requeueRunning(pool, cfg, dima.id);
  expect((await pool.query("select status, attempts from jobs")).rows[0]).toEqual({ status: "queued", attempts: 1 });
  await nextJobFor(pool, cfg, dima.id); await requeueRunning(pool, cfg, dima.id);
  expect((await pool.query("select status from jobs")).rows[0].status).toBe("failed");
  const m = await pool.query("select text from messages where thread_id=$1 order by id desc limit 1", [threadId]);
  expect(m.rows[0].text).toContain("не смог ответить");
});
test("неуспешное завершение пишет причину в ветку", async () => {
  const [{ threadId }] = await q(1);
  const j = await nextJobFor(pool, cfg, dima.id); await finishJob(pool, j!.jobId, false, "boom");
  const m = await pool.query("select text from messages where thread_id=$1 order by id desc limit 1", [threadId]);
  expect(m.rows[0].text).toContain("boom");
});
test("зависшее задание истекает по таймауту", async () => {
  await q(1); await nextJobFor(pool, cfg, dima.id);
  await pool.query("update jobs set started_at=now()-interval '1 hour'");
  await expireStale(pool, cfg);
  expect((await pool.query("select status from jobs")).rows[0].status).toBe("queued");
});
test("дубль задания на ту же пару не создаётся", async () => {
  const [{ threadId }] = await q(1); await enqueueJob(pool)(threadId, dima.id);
  expect((await pool.query("select count(*)::int n from jobs")).rows[0].n).toBe(1);
});
