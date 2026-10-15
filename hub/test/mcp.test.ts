import { afterEach, beforeEach, test, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { freshDb, testConfig as cfg } from "./helpers.js";
import { buildServer } from "../src/server.js";
import { setInviteCode } from "../src/members.js";

let app: any, pool: any, base: string;
beforeEach(async () => {
  pool = await freshDb(); await setInviteCode(pool, cfg, "c"); app = await buildServer(pool, cfg);
  await app.listen({ port: 0, host: "127.0.0.1" }); base = `http://127.0.0.1:${app.server.address().port}/mcp`;
});
afterEach(async () => { await app.close(); await pool.end(); });

async function client(headers: Record<string, string>) {
  const c = new Client({ name: "t", version: "1" });
  await c.connect(new StreamableHTTPClientTransport(new URL(base), { requestInit: { headers } }));
  return c;
}
const call = async (c: Client, name: string, args: any = {}) => {
  const r: any = await c.callTool({ name, arguments: args });
  return { err: !!r.isError, data: r.isError ? r.content[0].text : JSON.parse(r.content[0].text) };
};
const rawPost = (headers: Record<string, string>) => fetch(base, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
});

test("регистрация по коду, потом работа по токену", async () => {
  const anon = await client({ "X-Invite-Code": "c" });
  expect((await anon.listTools()).tools.map((t) => t.name)).toEqual(["register"]);
  const reg = await call(anon, "register", { full_name: "Дмитрий Середа", short_name: "Дмитрий", projects: [{ name: "fin", local_path: "D:/fin" }] });
  expect(reg.data.token).toMatch(/^tb_/);
  expect(reg.data.next).toContain("teambridge save-token");
  const me = await client({ Authorization: `Bearer ${reg.data.token}` });
  expect((await me.listTools()).tools.map((t) => t.name).sort()).toEqual(["ask", "decide", "decisions", "directory", "inbox", "my_projects", "reply", "thread", "whoami"]);
  expect((await call(me, "whoami")).data).toMatchObject({ shortName: "Дмитрий", isAdmin: true, projects: [{ name: "fin", localPath: "D:/fin" }] });
});

test("неверный код приглашения — ошибка инструмента", async () => {
  const anon = await client({ "X-Invite-Code": "wrong" });
  const r = await call(anon, "register", { full_name: "А", short_name: "а" });
  expect(r.err).toBe(true);
  expect(r.data).toContain("Неверный код");
});

test("без заголовков и с плохим токеном — 401", async () => {
  expect((await rawPost({})).status).toBe(401);
  expect((await rawPost({ authorization: "Bearer tb_bad" })).status).toBe(401);
});

test("переписка через MCP и ошибки как isError", async () => {
  const anon = await client({ "X-Invite-Code": "c" });
  const a = (await call(anon, "register", { full_name: "А", short_name: "а" })).data.token;
  const b = (await call(anon, "register", { full_name: "Б", short_name: "б", projects: [{ name: "fin" }] })).data.token;
  const ca = await client({ Authorization: `Bearer ${a}` });
  const cb = await client({ Authorization: `Bearer ${b}` });
  expect((await call(ca, "directory", { query: "fin" })).data.map((x: any) => x.shortName)).toEqual(["б"]);
  const t = (await call(ca, "ask", { project: "fin", subject: "тема", text: "вопрос" })).data;
  expect((await call(cb, "inbox")).data.threads[0].id).toBe(t.threadId);
  await call(cb, "reply", { thread_id: t.threadId, text: "ответ", actions: [{ kind: "mr", url: "https://git/mr/1" }] });
  expect((await call(ca, "thread", { thread_id: t.threadId })).data.messages[1].actions[0].kind).toBe("mr");
  await call(cb, "decide", { thread_id: t.threadId, summary: "решили так" });
  expect((await call(ca, "decisions", { project: "fin" })).data[0].summary).toBe("решили так");
  const bad = await call(ca, "ask", { project: "nope", subject: "s", text: "q" });
  expect(bad.err).toBe(true);
  expect(bad.data).toContain("не найден");
  expect((await call(ca, "my_projects", { add: [{ name: "x", local_path: "/x" }] })).data).toEqual([{ name: "x", gitRemote: null, localPath: "/x" }]);
});
