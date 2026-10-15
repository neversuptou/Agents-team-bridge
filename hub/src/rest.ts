import type { FastifyInstance } from "fastify";
import type { Pool } from "./db.js";
import type { Config } from "./config.js";
import { authenticate, revoke, setInviteCode, HubError, type Member } from "./members.js";
import { directory } from "./projects.js";
import * as threads from "./threads.js";
import type { AgentGateway } from "./agentGateway.js";

export const bearer = (h?: string) => (h?.startsWith("Bearer ") ? h.slice(7) : undefined);

// REST для хука сводки, ответчика и веб-страницы; всё под /api — только с токеном
export function registerRest(app: FastifyInstance, pool: Pool, cfg: Config, gateway: AgentGateway) {
  app.addHook("preHandler", async (req: any, reply) => {
    if (!req.url.startsWith("/api/")) return;
    const m = await authenticate(pool, cfg, bearer(req.headers.authorization) ?? "");
    if (!m) return reply.code(401).send({ error: "unauthorized" });
    req.member = m;
  });
  const me = (req: any) => req.member as Member;
  const handle = (fn: (req: any) => Promise<unknown>) => async (req: any, reply: any) => {
    try { return await fn(req); }
    catch (e) {
      if (e instanceof HubError) return reply.code(e.code === "forbidden" ? 403 : 400).send({ error: e.code, message: e.message });
      throw e;
    }
  };
  const requireAdmin = (req: any) => { if (!me(req).isAdmin) throw new HubError("forbidden", "Только админ"); };

  app.get("/api/me", handle(async (r) => me(r)));
  app.get("/api/digest", handle(async (r) => threads.digest(pool, me(r), r.query.since)));
  app.get("/api/members", handle(async () => directory(pool, gateway.online())));
  app.get("/api/decisions", handle(async (r) => threads.listDecisions(pool, { project: r.query.project, query: r.query.q })));
  app.get("/api/threads", handle(async (r) => (await pool.query(`select t.id, t.subject, t.status, t.turns, t.updated_at, p.name project
      from threads t join thread_participants tp on tp.thread_id=t.id and tp.member_id=$1 left join projects p on p.id=t.project_id
      order by t.updated_at desc limit 200`, [me(r).id])).rows));
  app.get("/api/threads/:id", handle(async (r) => threads.getThread(pool, me(r), Number(r.params.id))));
  app.post("/api/admin/invite", handle(async (r) => {
    requireAdmin(r);
    const code = String(r.body?.code ?? "").trim();
    if (code.length < 4) throw new HubError("invalid_invite_code", "Код приглашения — не короче 4 символов");
    await setInviteCode(pool, cfg, code);
    return { ok: true };
  }));
  app.post("/api/admin/revoke", handle(async (r) => { await revoke(pool, me(r).id, Number(r.body?.memberId)); return { ok: true }; }));
}
