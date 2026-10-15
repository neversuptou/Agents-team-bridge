import { afterEach, beforeEach, test, expect } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { createProxy } from "../src/proxy.js";

// поддельный хаб: инструменты reply и whoami, запоминает, что дошло и с каким токеном
let http: HttpServer, hub: string, received: any[], auth: string[];
beforeEach(async () => {
  received = []; auth = [];
  http = createServer(async (req, res) => {
    auth.push(String(req.headers.authorization));
    if (req.method !== "POST") { res.writeHead(405).end(); return; }
    const body = await new Promise<any>((r) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => r(JSON.parse(s))); });
    const s = new McpServer({ name: "hub", version: "1" }, { instructions: "правила хаба" });
    s.registerTool("whoami", { inputSchema: {} }, async () => ({ content: [{ type: "text", text: "я" }] }));
    s.registerTool("reply", { inputSchema: { thread_id: z.number(), text: z.string(), about_evapps: z.boolean() } },
      async (a) => { received.push(a); return { content: [{ type: "text", text: "ok" }] }; });
    const t = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await s.connect(t); await t.handleRequest(req, res, body);
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  hub = `http://127.0.0.1:${(http.address() as any).port}`;
});
afterEach(() => new Promise((r) => http.close(r)));

async function claude(answers: boolean[] | null) {
  const proxy = await createProxy({ hub, token: "tb_test" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: "claude", version: "1" }, { capabilities: answers ? { elicitation: {} } : {} });
  if (answers) c.setRequestHandler(ElicitRequestSchema, async () => (answers.shift() ? { action: "accept", content: { confirm: true } } : { action: "decline" }));
  await proxy.connect(b); await c.connect(a);
  return c;
}

test("инструменты и правила хаба видны Claude; токен уходит только в хаб", async () => {
  const c = await claude([]);
  expect((await c.listTools()).tools.map((t) => t.name).sort()).toEqual(["reply", "whoami"]);
  expect(c.getInstructions()).toBe("правила хаба");
  expect(auth.every((h) => h === "Bearer tb_test")).toBe(true);
});

test("отправка — только после подтверждения человека", async () => {
  const c = await claude([false, true]);
  const no: any = await c.callTool({ name: "reply", arguments: { thread_id: 1, text: "черновик", about_evapps: true } });
  expect(no.isError).toBe(true);
  expect(received).toEqual([]);
  await c.callTool({ name: "reply", arguments: { thread_id: 1, text: "ответ", about_evapps: true } });
  expect(received).toEqual([{ thread_id: 1, text: "ответ", about_evapps: true }]);
});

test("без поддержки окна подтверждения ничего не отправляется, чтение работает", async () => {
  const c = await claude(null);
  const r: any = await c.callTool({ name: "reply", arguments: { thread_id: 1, text: "x", about_evapps: true } });
  expect(r.isError).toBe(true);
  expect(r.content[0].text).toContain("подтверждени");
  expect(received).toEqual([]);
  expect(((await c.callTool({ name: "whoami", arguments: {} })) as any).content[0].text).toBe("я");
});

test("по открытому http — только локальный хаб", async () => {
  await expect(createProxy({ hub: "http://10.10.140.2:8120", token: "tb_x" })).rejects.toThrow(/https/);
});
