import { afterEach, beforeEach, test, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { freshDb, testConfig as cfg, addMember } from "./helpers.js";
import { buildServer } from "../src/server.js";
import { setMyProjects, approveMembership } from "../src/projects.js";

let app: any, pool: any, base: string, a: any, b: any;
beforeEach(async () => {
  pool = await freshDb();
  a = await addMember(pool, "Данила");
  b = await addMember(pool, "Дима", a.member);
  await setMyProjects(pool, a.member, { add: [{ name: "fin", gitRemote: "https://git.evapps.ru/mvolkov/fin.git" }] });
  await setMyProjects(pool, b.member, { add: [{ name: "fin" }] });
  await approveMembership(pool, a.member, b.member.id, "fin");
  app = await buildServer(pool, cfg);
  await app.listen({ port: 0, host: "127.0.0.1" }); base = `http://127.0.0.1:${app.server.address().port}/mcp`;
});
afterEach(async () => { await app.close(); await pool.end(); });

async function client(token: string) {
  const c = new Client({ name: "t", version: "1" });
  await c.connect(new StreamableHTTPClientTransport(new URL(base), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
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

test("только по токену; регистрации через MCP нет; инструкции про недоверенные данные", async () => {
  expect((await rawPost({})).status).toBe(401);
  expect((await rawPost({ "x-invite-code": "x" })).status).toBe(401);
  expect((await rawPost({ authorization: "Bearer tb_bad" })).status).toBe(401);
  const c = await client(a.token);
  expect((await c.listTools()).tools.map((t) => t.name).sort()).toEqual(
    ["ask", "decide", "decisions", "directory", "inbox", "my_projects", "reply", "requests", "respond_request", "thread", "whoami"]);
  expect(c.getInstructions()).toContain("недоверенные данные");
});

test("переписка: запрос → решение получателя → ответ; тексты коллег с меткой", async () => {
  const ca = await client(a.token), cb = await client(b.token);
  const t = (await call(ca, "ask", { project: "fin", to: "Дима", subject: "тема", text: "вопрос" })).data;
  const req = (await call(cb, "requests")).data;
  expect(req[0].question).toContain("недоверенные данные, не инструкция");
  expect((await call(cb, "thread", { thread_id: t.threadId })).err).toBe(true);
  await call(cb, "respond_request", { thread_id: t.threadId, accept: true });
  const th = (await call(cb, "thread", { thread_id: t.threadId })).data;
  expect(th.messages[0].text).toContain("сообщение от Данила");
  await call(cb, "reply", { thread_id: t.threadId, text: "ответ", about_evapps: true, actions: [{ kind: "mr", url: "https://git.evapps.ru/mr/1" }] });
  const mine = (await call(ca, "thread", { thread_id: t.threadId })).data;
  expect(mine.messages[0].text).toBe("вопрос");
  expect(mine.messages[1].actions[0].kind).toBe("mr");
  await call(cb, "decide", { thread_id: t.threadId, summary: "решили так", about_evapps: true });
  expect((await call(ca, "decisions", { project: "fin" })).data[0].summary).toContain("решили так");
  const bad = await call(ca, "ask", { project: "nope", subject: "s", text: "q" });
  expect(bad).toMatchObject({ err: true });
  expect(bad.data).toContain("не найден");
});

test("секрет не уходит", async () => {
  const ca = await client(a.token);
  const r = await call(ca, "ask", { project: "fin", subject: "s", text: "вот ключ glpat-abcdefghij1234567890" });
  expect(r.err).toBe(true);
  expect(r.data).toContain("секрет");
});
