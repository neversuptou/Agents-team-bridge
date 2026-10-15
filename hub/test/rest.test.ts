import { afterEach, beforeEach, test, expect } from "vitest";
import WebSocket from "ws";
import { freshDb, testConfig } from "./helpers.js";
import { buildServer } from "../src/server.js";
import { setInviteCode, register } from "../src/members.js";

let app: any, pool: any, base: string, admin: any, user: any;
beforeEach(async () => {
  pool = await freshDb(); await setInviteCode(pool, testConfig, "c");
  admin = await register(pool, testConfig, { inviteCode: "c", fullName: "А", shortName: "а" });
  user = await register(pool, testConfig, { inviteCode: "c", fullName: "Б", shortName: "б" });
  app = await buildServer(pool, testConfig); await app.listen({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${app.server.address().port}`;
});
afterEach(async () => { await app.close(); await pool.end(); });

const get = (p: string, t?: string) => fetch(base + p, { headers: t ? { authorization: `Bearer ${t}` } : {} });
const post = (p: string, t: string, body: any) => fetch(base + p, {
  method: "POST", headers: { authorization: `Bearer ${t}`, "content-type": "application/json" }, body: JSON.stringify(body),
});

test("401 без токена, me с токеном", async () => {
  expect((await get("/api/me")).status).toBe(401);
  expect(await (await get("/api/me", user.token)).json()).toMatchObject({ shortName: "б" });
});

test("ветки, решения, люди, сводка", async () => {
  await app.services.ask(admin.member, { to: "б", subject: "тема", text: "q" });
  const threads = await (await get("/api/threads", user.token)).json();
  expect(threads[0]).toMatchObject({ subject: "тема", status: "waiting" });
  expect((await (await get("/api/threads/" + threads[0].id, user.token)).json()).messages.length).toBe(1);
  expect(await (await get("/api/decisions", user.token)).json()).toEqual([]);
  expect((await (await get("/api/members", user.token)).json()).length).toBe(2);
  expect((await (await get("/api/digest", user.token)).json()).open.length).toBe(1);
});

test("чужая ветка — 403", async () => {
  const third = await register(pool, testConfig, { inviteCode: "c", fullName: "В", shortName: "в" });
  const { threadId } = await app.services.ask(admin.member, { to: "б", subject: "s", text: "q" });
  expect((await get("/api/threads/" + threadId, third.token)).status).toBe(403);
});

test("админские ручки", async () => {
  expect((await post("/api/admin/invite", user.token, { code: "x" })).status).toBe(403);
  expect((await post("/api/admin/invite", admin.token, { code: "new-code" })).status).toBe(200);
  await expect(register(pool, testConfig, { inviteCode: "c", fullName: "В", shortName: "в" })).rejects.toMatchObject({ code: "invalid_invite" });
  expect((await get("/api/me", user.token)).status).toBe(200);
  expect((await post("/api/admin/revoke", admin.token, { memberId: user.member.id })).status).toBe(200);
  expect((await get("/api/me", user.token)).status).toBe(401);
});

test("пустой код приглашения не принимается", async () => {
  expect((await post("/api/admin/invite", admin.token, { code: " " })).status).toBe(400);
});

test("отозванный ответчик отключается на проверке", async () => {
  const ws = new WebSocket(base.replace("http", "ws") + "/agent");
  await new Promise((r) => ws.on("open", r));
  ws.send(JSON.stringify({ type: "hello", token: user.token }));
  for (let i = 0; i < 50 && !app.gateway.online().has(user.member.id); i++) await new Promise((r) => setTimeout(r, 20));
  await post("/api/admin/revoke", admin.token, { memberId: user.member.id });
  const closed = new Promise<number>((res) => ws.on("close", (c) => res(c)));
  await app.gateway.tick();
  expect(await closed).toBe(4401);
});

test("веб-страница отдаётся", async () => {
  const r = await get("/");
  expect(r.status).toBe(200);
  expect(await r.text()).toContain("TeamBridge");
});

test("страница подключения по короткому адресу", async () => {
  const r = await get("/install?code=abc");
  expect(r.status).toBe(200);
  expect(await r.text()).toContain("TeamBridge — подключение");
});
