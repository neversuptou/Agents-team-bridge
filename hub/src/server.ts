import Fastify from "fastify";
import websocket from "@fastify/websocket";
import type { Pool } from "./db.js";
import type { Config } from "./config.js";
import { AgentGateway } from "./agentGateway.js";
import { enqueueJob } from "./jobs.js";
import * as threads from "./threads.js";
import type { Member } from "./members.js";

export async function buildServer(pool: Pool, cfg: Config) {
  const app = Fastify({ logger: false }) as any;
  await app.register(websocket);
  const gateway = new AgentGateway(pool, cfg);
  const sink: threads.JobSink = async (threadId, memberId) => { await enqueueJob(pool)(threadId, memberId); await gateway.notify(memberId); };
  app.decorate("gateway", gateway);
  app.decorate("services", { ask: (m: Member, a: any) => threads.ask(pool, cfg, sink, m, a, gateway.online()) });
  app.register(async (scope: any) => gateway.register(scope));
  return app;
}
