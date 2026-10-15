import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { Pool } from "./db.js";
import type { Config } from "./config.js";
import { authenticate, type Member } from "./members.js";
import { nextJobFor, finishJob, requeueRunning, expireStale } from "./jobs.js";

/*
  Подключения ответчиков (WebSocket /agent). Протокол JSON:
  клиент → {type:"hello", token}; сервер → {type:"ready", member} или {type:"error"} + закрытие 4401;
  сервер → {type:"job", jobId, threadId, subject, project:{name, localPath}|null}; клиент → {type:"finished", jobId, ok, error?};
  сервер → {type:"ping"} раз в 30 с (заодно проверка, не отозван ли токен).
*/
export class AgentGateway {
  private sockets = new Map<number, { ws: WebSocket; token: string }>();
  private timer?: NodeJS.Timeout;
  private closed = false;
  constructor(private pool: Pool, private cfg: Config) {}

  online() { return new Set(this.sockets.keys()); }

  // Выдать участнику следующее задание, если он подключён и свободен
  async notify(memberId: number) {
    const s = this.sockets.get(memberId);
    if (!s) return;
    const job = await nextJobFor(this.pool, this.cfg, memberId);
    if (!job) return;
    const r = (await this.pool.query(`select t.subject, p.name, mp.local_path from threads t left join projects p on p.id=t.project_id
      left join member_projects mp on mp.project_id=p.id and mp.member_id=$2 where t.id=$1`, [job.threadId, memberId])).rows[0];
    s.ws.send(JSON.stringify({ type: "job", jobId: job.jobId, threadId: job.threadId, subject: r?.subject,
      project: r?.name ? { name: r.name, localPath: r.local_path } : null }));
  }

  // Раз в 30 с: таймауты заданий, отозванные токены, ping, раздача ожидающих заданий
  async tick() {
    await expireStale(this.pool, this.cfg);
    for (const [id, s] of [...this.sockets]) {
      if (!(await authenticate(this.pool, this.cfg, s.token))) { this.sockets.delete(id); s.ws.close(4401, "unauthorized"); continue; }
      s.ws.send(JSON.stringify({ type: "ping" }));
      await this.notify(id);
    }
  }

  register(app: FastifyInstance) {
    app.get("/agent", { websocket: true }, (ws: WebSocket) => {
      let member: Member | null = null;
      ws.on("message", (raw) => { this.handle(ws, raw, member, (m) => { member = m; }).catch((e) => app.log.error(e)); });
      ws.on("close", () => {
        if (this.closed || !member || this.sockets.get(member.id)?.ws !== ws) return;
        this.sockets.delete(member.id);
        requeueRunning(this.pool, this.cfg, member.id).catch((e) => app.log.error(e));
      });
    });
    this.timer = setInterval(() => { this.tick().catch((e) => app.log.error(e)); }, 30_000);
    app.addHook("onClose", async () => { this.closed = true; clearInterval(this.timer); });
  }

  private async handle(ws: WebSocket, raw: unknown, member: Member | null, setMember: (m: Member) => void) {
    if (this.closed) return;
    let m: any;
    try { m = JSON.parse(String(raw)); } catch { return; }
    if (m.type === "hello") {
      const who = await authenticate(this.pool, this.cfg, m.token);
      if (!who) { ws.send(JSON.stringify({ type: "error", code: "unauthorized" })); ws.close(4401, "unauthorized"); return; }
      setMember(who);
      const prev = this.sockets.get(who.id);
      this.sockets.set(who.id, { ws, token: m.token });
      prev?.ws.close(4000, "replaced");
      ws.send(JSON.stringify({ type: "ready", member: { id: who.id, shortName: who.shortName } }));
      await requeueRunning(this.pool, this.cfg, who.id);
      await this.notify(who.id);
    } else if (member && m.type === "finished") {
      await finishJob(this.pool, Number(m.jobId), !!m.ok, m.error);
      await this.notify(member.id);
    }
  }
}
