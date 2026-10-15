import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Pool } from "./db.js";
import type { Config } from "./config.js";
import { authenticate } from "./members.js";
import { buildMcp } from "./mcp.js";
import { registerRest, bearer } from "./rest.js";

export async function buildServer(pool: Pool, cfg: Config) {
  const https = cfg.tlsCert && cfg.tlsKey ? { key: readFileSync(cfg.tlsKey), cert: readFileSync(cfg.tlsCert) } : null;
  const app = Fastify({
    ...(https ? { https } : {}),
    bodyLimit: 64 * 1024,
    // в логах только путь без параметров: ни токенов, ни приглашений
    logger: process.env.NODE_ENV === "production" ? {
      serializers: { req: (r: any) => ({ method: r.method, url: String(r.url).split(/[?#]/)[0], ip: r.ip }) },
    } : false,
  }) as any;
  app.addHook("onSend", async (_req: any, reply: any) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("x-frame-options", "DENY");
    reply.header("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'");
    if (https) reply.header("strict-transport-security", "max-age=31536000");
  });
  await app.register(fastifyStatic, { root: fileURLToPath(new URL("../public", import.meta.url)) });
  registerRest(app, pool, cfg);

  // MCP по Streamable HTTP без сессий: на каждый запрос свой сервер с правами вызывающего
  app.post("/mcp", async (req: any, reply: any) => {
    const member = await authenticate(pool, cfg, bearer(req.headers.authorization) ?? "");
    if (!member) return reply.code(401).send({ error: "unauthorized" });
    const server = buildMcp(pool, cfg, member);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.on("close", () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });
  // страница подключения; приглашение передаётся во фрагменте ссылки (#invite=…) и на сервер не уходит
  app.get("/install", async (_r: any, reply: any) => reply.sendFile("install.html"));
  for (const method of ["get", "delete"]) app[method]("/mcp", async (_r: any, reply: any) => reply.code(405).send({ error: "method_not_allowed" }));
  return app;
}
