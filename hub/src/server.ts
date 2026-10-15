import Fastify from "fastify";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Pool } from "./db.js";
import type { Config } from "./config.js";
import { AgentGateway } from "./agentGateway.js";
import { enqueueJob } from "./jobs.js";
import { authenticate, type Member } from "./members.js";
import * as threads from "./threads.js";
import { buildMcp } from "./mcp.js";
import { registerRest, bearer } from "./rest.js";

export async function buildServer(pool: Pool, cfg: Config) {
  const app = Fastify({ logger: process.env.NODE_ENV === "production" }) as any;
  await app.register(websocket);
  await app.register(fastifyStatic, { root: fileURLToPath(new URL("../public", import.meta.url)) });

  const gateway = new AgentGateway(pool, cfg);
  // новое сообщение в ветке → задание ответчику другого участника и попытка выдать его сразу
  const sink: threads.JobSink = async (threadId, memberId) => { await enqueueJob(pool)(threadId, memberId); await gateway.notify(memberId); };
  app.decorate("gateway", gateway);
  app.decorate("services", { ask: (m: Member, a: any) => threads.ask(pool, cfg, sink, m, a, gateway.online()) });

  app.register(async (scope: any) => gateway.register(scope));
  registerRest(app, pool, cfg, gateway);

  // MCP по Streamable HTTP без сессий: на каждый запрос свой сервер с правами вызывающего
  app.post("/mcp", async (req: any, reply: any) => {
    const token = bearer(req.headers.authorization);
    const member = token ? await authenticate(pool, cfg, token) : null;
    const inviteCode = token ? undefined : (req.headers["x-invite-code"] as string | undefined);
    if (!member && !inviteCode) return reply.code(401).send({ error: "unauthorized" });
    const server = buildMcp(pool, cfg, gateway, sink, { member: member ?? undefined, inviteCode });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.on("close", () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });
  for (const method of ["get", "delete"]) app[method]("/mcp", async (_r: any, reply: any) => reply.code(405).send({ error: "method_not_allowed" }));
  return app;
}
