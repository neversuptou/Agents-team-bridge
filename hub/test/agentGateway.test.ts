import { afterEach, beforeEach, test, expect } from "vitest";
import WebSocket from "ws";
import { freshDb, testConfig as cfg } from "./helpers.js";
import { buildServer } from "../src/server.js";
import { setInviteCode, register } from "../src/members.js";
let app: any, pool: any, url: string, me: any, dima: any;
beforeEach(async () => {
  pool = await freshDb(); await setInviteCode(pool, cfg, "c");
  me = await register(pool, cfg, { inviteCode: "c", fullName: "А", shortName: "а" });
  dima = await register(pool, cfg, { inviteCode: "c", fullName: "Д", shortName: "д" });
  app = await buildServer(pool, cfg); await app.listen({ port: 0, host: "127.0.0.1" });
  url = `ws://127.0.0.1:${app.server.address().port}/agent`;
});
afterEach(async () => { await app.close(); await pool.end(); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(f: () => boolean | Promise<boolean>) { for (let i = 0; i < 100; i++) { if (await f()) return; await sleep(30); } }
function connect(token: string) {
  const ws = new WebSocket(url); const msgs: any[] = [];
  ws.on("message", (d) => msgs.push(JSON.parse(String(d))));
  return new Promise<{ ws: WebSocket; msgs: any[] }>((res) => ws.on("open", () => { ws.send(JSON.stringify({ type: "hello", token })); res({ ws, msgs }); }));
}
const jobStatus = async () => (await pool.query("select status from jobs order by id limit 1")).rows[0]?.status;
test("ответчик получает задание, онлайн-статус, завершение", async () => {
  const { ws, msgs } = await connect(dima.token);
  await until(() => msgs.some((m) => m.type === "ready"));
  expect(app.gateway.online().has(dima.member.id)).toBe(true);
  const { threadId } = await app.services.ask(me.member, { to: "д", subject: "s", text: "q" });
  await until(() => msgs.some((m) => m.type === "job"));
  const job = msgs.find((m) => m.type === "job"); expect(job.threadId).toBe(threadId); expect(job.project).toBeNull();
  ws.send(JSON.stringify({ type: "finished", jobId: job.jobId, ok: true }));
  await until(async () => (await jobStatus()) === "done");
  expect(await jobStatus()).toBe("done");
  ws.close(); await until(() => !app.gateway.online().has(dima.member.id));
  expect(app.gateway.online().has(dima.member.id)).toBe(false);
});
test("неверный токен — закрытие 4401", async () => {
  const ws = new WebSocket(url);
  const code = await new Promise<number>((res) => { ws.on("open", () => ws.send(JSON.stringify({ type: "hello", token: "tb_bad" }))); ws.on("close", (c) => res(c)); });
  expect(code).toBe(4401);
});
test("задание, созданное до подключения, выдаётся при подключении", async () => {
  await app.services.ask(me.member, { to: "д", subject: "s", text: "q" });
  const { msgs } = await connect(dima.token);
  await until(() => msgs.some((m) => m.type === "job"));
  expect(msgs.some((m) => m.type === "job")).toBe(true);
});
test("разрыв посреди задания возвращает его в очередь", async () => {
  await app.services.ask(me.member, { to: "д", subject: "s", text: "q" });
  const { ws, msgs } = await connect(dima.token); await until(() => msgs.some((m) => m.type === "job"));
  ws.terminate(); await until(() => !app.gateway.online().has(dima.member.id));
  await until(async () => (await jobStatus()) === "queued");
  expect(await jobStatus()).toBe("queued");
});
