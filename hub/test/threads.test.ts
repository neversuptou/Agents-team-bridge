import { beforeEach, afterEach, test, expect } from "vitest";
import { freshDb, testConfig as cfg } from "./helpers.js";
import { setInviteCode, register } from "../src/members.js";
import { setMyProjects } from "../src/projects.js";
import { ask, reply, decide, getThread, inbox, listDecisions, digest } from "../src/threads.js";
let pool: any, me: any, dima: any, ivan: any, jobs: [number, number][];
const sink = async (t: number, m: number) => { jobs.push([t, m]); };
beforeEach(async () => {
  pool = await freshDb(); await setInviteCode(pool, cfg, "c"); jobs = [];
  me = (await register(pool, cfg, { inviteCode: "c", fullName: "Дмитрий Середа", shortName: "Дмитрий" })).member;
  dima = (await register(pool, cfg, { inviteCode: "c", fullName: "Дмитрий Волков", shortName: "Дима" })).member;
  ivan = (await register(pool, cfg, { inviteCode: "c", fullName: "Иван Иванов", shortName: "Иван" })).member;
  await setMyProjects(pool, dima.id, { add: [{ name: "fin" }] });
  await setMyProjects(pool, ivan.id, { add: [{ name: "fin" }] });
});
afterEach(async () => { await pool.end(); });
test("по проекту выбирается владелец в сети", async () => {
  const r = await ask(pool, cfg, sink, me, { project: "fin", subject: "s", text: "q" }, new Set([ivan.id]));
  expect(r.recipientShortName).toBe("Иван"); expect(jobs).toEqual([[r.threadId, ivan.id]]);
});
test("никого в сети — первый владелец, статус waiting", async () => {
  const r = await ask(pool, cfg, sink, me, { project: "fin", subject: "s", text: "q" }, new Set());
  expect(r.recipientShortName).toBe("Дима"); expect(r.status).toBe("waiting");
});
test("по имени", async () => {
  const r = await ask(pool, cfg, sink, me, { to: "дима", subject: "s", text: "q" }, new Set());
  expect(r.recipientShortName).toBe("Дима");
});
test("ошибки адресации", async () => {
  await expect(ask(pool, cfg, sink, me, { to: "Дмитрий", subject: "s", text: "q" }, new Set())).rejects.toMatchObject({ code: "self_ask" });
  await expect(ask(pool, cfg, sink, me, { project: "nope", subject: "s", text: "q" }, new Set())).rejects.toMatchObject({ code: "unknown_project" });
  await setMyProjects(pool, me.id, { add: [{ name: "solo" }] });
  await expect(ask(pool, cfg, sink, me, { project: "solo", subject: "s", text: "q" }, new Set())).rejects.toMatchObject({ code: "no_owners" });
  await expect(ask(pool, cfg, sink, me, { to: "Дмитрий Середа", project: "fin", subject: "s", text: "q" }, new Set())).rejects.toMatchObject({ code: "self_ask" });
  await expect(ask(pool, cfg, sink, me, { to: "Иван", project: "solo", subject: "s", text: "q" }, new Set())).rejects.toMatchObject({ code: "not_owner" });
  await expect(ask(pool, cfg, sink, me, { subject: "s", text: "q" }, new Set())).rejects.toMatchObject({ code: "no_recipient" });
  await expect(ask(pool, cfg, sink, me, { to: "Никто", subject: "s", text: "q" }, new Set())).rejects.toMatchObject({ code: "unknown_member" });
  expect(jobs).toEqual([]);
});
test("переписка по очереди и лимит реплик", async () => {
  const { threadId } = await ask(pool, cfg, sink, me, { to: "Дима", subject: "s", text: "1" }, new Set());
  const who = [dima, me];
  for (let i = 2; i <= 9; i++) await reply(pool, cfg, sink, who[i % 2], { threadId, text: String(i) });
  expect(jobs.length).toBe(9);
  expect(jobs.map((j) => j[1])).toEqual([dima.id, me.id, dima.id, me.id, dima.id, me.id, dima.id, me.id, dima.id]);
  const last = await reply(pool, cfg, sink, me, { threadId, text: "10" });
  expect(last).toEqual({ status: "needs_human", turns: 10 });
  expect(jobs.length).toBe(9);
  await expect(reply(pool, cfg, sink, dima, { threadId, text: "11" })).rejects.toMatchObject({ code: "needs_human" });
});
test("маскирование и доступ к ветке", async () => {
  const { threadId } = await ask(pool, cfg, sink, me, { to: "Дима", subject: "s", text: "ключ glpat-AbCdEf1234567890xyz12" }, new Set());
  const t = await getThread(pool, dima, threadId);
  expect(t.messages[0].text).toContain("[скрыто]"); expect(t.messages[0].author).toBe("Дмитрий");
  await expect(getThread(pool, ivan, threadId)).rejects.toMatchObject({ code: "forbidden" });
});
test("decide закрывает ветку, решения ищутся, reply в закрытую — ошибка", async () => {
  const { threadId } = await ask(pool, cfg, sink, me, { project: "fin", subject: "сброс периода", text: "q" }, new Set([dima.id]));
  await decide(pool, dima, { threadId, summary: "Одна пустая дата — отказ, не сброс", links: ["https://git/mr/1"] });
  const t = await getThread(pool, me, threadId);
  expect(t.status).toBe("closed"); expect(t.decision).toContain("отказ");
  expect((await listDecisions(pool, { project: "fin" }))[0].summary).toContain("отказ");
  expect((await listDecisions(pool, { query: "пустая" })).length).toBe(1);
  await expect(reply(pool, cfg, sink, me, { threadId, text: "x" })).rejects.toMatchObject({ code: "thread_closed" });
});
test("inbox помечает прочитанным, digest — нет", async () => {
  const { threadId } = await ask(pool, cfg, sink, me, { to: "Дима", subject: "s", text: "q" }, new Set());
  expect((await digest(pool, dima)).open.length).toBe(1);
  const i1 = await inbox(pool, dima); expect(i1.threads[0]).toMatchObject({ id: threadId, newMessages: 1 });
  const i2 = await inbox(pool, dima); expect(i2.threads.length).toBe(0);
  expect((await digest(pool, dima)).open.length).toBe(1);
  expect((await inbox(pool, me)).threads.length).toBe(0); // своё сообщение — не новое
});
test("итоги попадают в inbox участников один раз", async () => {
  const { threadId } = await ask(pool, cfg, sink, me, { to: "Дима", subject: "s", text: "q" }, new Set());
  await decide(pool, dima, { threadId, summary: "итог" });
  expect((await inbox(pool, me)).decisions).toEqual([{ threadId, summary: "итог" }]);
  expect((await inbox(pool, me)).decisions).toEqual([]);
  expect((await inbox(pool, ivan)).decisions).toEqual([]);
});
