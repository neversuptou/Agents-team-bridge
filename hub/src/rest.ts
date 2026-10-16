import type { FastifyInstance } from "fastify";
import type { Pool } from "./db.js";
import type { Config } from "./config.js";
import { authenticate, revoke, createInvite, register, listInvites, revokeInvite, HubError, type Member } from "./members.js";
import { directory, pendingMemberships, approveMembership, markEvapps } from "./projects.js";
import * as threads from "./threads.js";

export const bearer = (h?: string) => (h?.startsWith("Bearer ") ? h.slice(7) : undefined);

// REST для веб-ленты; всё под /api — только с токеном, /api/admin — только админу
export function registerRest(app: FastifyInstance, pool: Pool, cfg: Config) {
  // проверяем шаблон сработавшего маршрута, а не req.url: роутер декодирует путь, и /%61pi/… попадает в /api/…
  app.addHook("preHandler", async (req: any, reply) => {
    const route: string = req.routeOptions?.url ?? "";
    if (!route.startsWith("/api/")) return;
    const m = await authenticate(pool, cfg, bearer(req.headers.authorization) ?? "");
    if (!m) return reply.code(401).send({ error: "unauthorized" });
    if (route.startsWith("/api/admin/") && !m.isAdmin) return reply.code(403).send({ error: "forbidden", message: "Только админ" });
    req.member = m;
  });
  const me = (req: any) => req.member as Member;
  const id = (v: unknown) => { const n = Number(v); if (!Number.isInteger(n)) throw new HubError("bad_id", "Неверный номер"); return n; };
  const handle = (fn: (req: any) => Promise<unknown>) => async (req: any, reply: any) => {
    try { return await fn(req); }
    catch (e) {
      if (e instanceof HubError) return reply.code(e.code === "forbidden" ? 403 : 400).send({ error: e.code, message: e.message });
      throw e;
    }
  };

  // регистрация по личному одноразовому приглашению (из командной строки, без токена)
  app.post("/register", handle(async (r) => {
    const res = await register(pool, cfg, { invite: String(r.body?.invite ?? ""), shortName: String(r.body?.shortName ?? ""), fullName: r.body?.fullName });
    return { token: res.token, member: res.member };
  }));

  app.get("/api/me", handle(async (r) => me(r)));
  app.post("/api/me/revoke", handle(async (r) => { await revoke(pool, me(r), me(r).id); return { ok: true }; }));
  app.get("/api/members", handle(async () => directory(pool)));
  app.get("/api/decisions", handle(async (r) => threads.listDecisions(pool, me(r), { project: r.query.project, query: r.query.q })));
  app.get("/api/threads", handle(async (r) => threads.listThreads(pool, me(r))));
  app.get("/api/requests", handle(async (r) => threads.pendingRequests(pool, me(r))));
  app.get("/api/threads/:id", handle(async (r) => threads.getThread(pool, me(r), id(r.params.id), { asAdmin: r.query.admin === "1" })));
  // решение человека-получателя по входящему запросу
  app.post("/api/threads/:id/respond", handle(async (r) => threads.respond(pool, me(r), id(r.params.id), r.body?.accept === true)));

  app.post("/api/admin/invites", handle(async (r) => {
    const inv = await createInvite(pool, cfg, me(r).id, { fullName: String(r.body?.fullName ?? ""), ttlHours: r.body?.ttlHours ? Number(r.body.ttlHours) : undefined });
    return { ...inv, link: `${r.protocol}://${r.headers.host}/install#invite=${inv.invite}` };
  }));
  app.get("/api/admin/invites", handle(async () => listInvites(pool)));
  app.post("/api/admin/invites/:id/revoke", handle(async (r) => { await revokeInvite(pool, me(r), id(r.params.id)); return { ok: true }; }));
  app.get("/api/admin/members", handle(async () => (await pool.query(
    "select id, full_name, short_name, is_admin, revoked_at, last_seen_at from members order by id")).rows));
  app.post("/api/admin/revoke", handle(async (r) => { await revoke(pool, me(r), id(r.body?.memberId)); return { ok: true }; }));
  app.get("/api/admin/pending-projects", handle(async () => pendingMemberships(pool)));
  app.post("/api/admin/projects/approve", handle(async (r) => {
    await approveMembership(pool, me(r), id(r.body?.memberId), String(r.body?.project ?? ""), r.body?.approve !== false); return { ok: true };
  }));
  app.post("/api/admin/projects/evapps", handle(async (r) => { await markEvapps(pool, me(r), String(r.body?.project ?? ""), r.body?.value !== false); return { ok: true }; }));
  app.get("/api/admin/projects", handle(async () => (await pool.query("select name, git_remote, is_evapps from projects order by name")).rows));
  app.get("/api/admin/quarantine", handle(async () => threads.listQuarantine(pool)));
  app.post("/api/admin/quarantine/:id", handle(async (r) => { await threads.resolveQuarantine(pool, me(r), id(r.params.id), r.body?.approve === true); return { ok: true }; }));
  app.post("/api/admin/messages/:id/delete", handle(async (r) => { await threads.deleteMessage(pool, me(r), id(r.params.id)); return { ok: true }; }));
  app.post("/api/admin/decisions/:id/delete", handle(async (r) => { await threads.deleteDecision(pool, me(r), id(r.params.id)); return { ok: true }; }));
  app.get("/api/admin/alerts", handle(async () => threads.listAlerts(pool)));
  app.post("/api/admin/alerts/:id/resolve", handle(async (r) => { await threads.resolveAlert(pool, me(r), id(r.params.id)); return { ok: true }; }));
  app.get("/api/admin/audit", handle(async () => (await pool.query(
    `select a.id, a.at, m.short_name actor, a.action, a.target, a.details from audit_log a left join members m on m.id=a.actor_id order by a.id desc limit 300`)).rows));
}
