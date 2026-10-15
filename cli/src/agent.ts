import WebSocket from "ws";
import type { CliConfig } from "./config.js";
import { prepareWorkspace } from "./workspace.js";
import { runClaude } from "./runner.js";
import { permissionSettings } from "./permissions.js";
import { responderPrompt } from "./prompt.js";

type Job = { jobId: number; threadId: number; subject?: string; project: { name: string; localPath: string | null } | null };
const log = (s: string) => console.log(`[${new Date().toISOString()}] ${s}`);

/*
  Ответчик: держит WebSocket с хабом, получает задания «ответь в ветке» и выполняет их строго по одному —
  рабочая копия → claude -p с запретами → {type:"finished"}. Разрыв — переподключение 5 с … 60 с.
*/
export class Agent {
  private ws?: WebSocket;
  private queue: Job[] = [];
  private busy = false;
  private stopped = false;
  private delay = 5000;
  private shortName = "";

  constructor(private cfg: CliConfig, private opts: { root: string; claudeBin?: string[]; timeoutMs?: number }) {}

  start() {
    if (this.stopped) return;
    const ws = (this.ws = new WebSocket(this.cfg.hub.replace(/^http/, "ws") + "/agent"));
    ws.on("open", () => ws.send(JSON.stringify({ type: "hello", token: this.cfg.token })));
    ws.on("message", (d) => {
      let m: any;
      try { m = JSON.parse(String(d)); } catch { return; }
      if (m.type === "ready") { this.delay = 5000; this.shortName = m.member.shortName; log(`подключён к хабу как ${this.shortName}`); }
      else if (m.type === "ping") ws.send(JSON.stringify({ type: "pong" }));
      else if (m.type === "job") { this.queue.push(m); void this.pump(); }
    });
    ws.on("close", (code) => {
      if (this.stopped) return;
      if (code === 4401) { log("хаб отклонил токен — выполните teambridge save-token"); this.delay = 60000; }
      setTimeout(() => this.start(), this.delay);
      this.delay = Math.min(this.delay * 2, 60000);
    });
    ws.on("error", () => { /* закрытие обработает close */ });
  }

  stop() { this.stopped = true; this.ws?.close(); }

  private async pump() {
    if (this.busy) return;
    const job = this.queue.shift();
    if (!job) return;
    this.busy = true;
    let res: { ok: boolean; error?: string };
    let ws: Awaited<ReturnType<typeof prepareWorkspace>> | undefined;
    try {
      ws = await prepareWorkspace({ ...job, root: this.opts.root });
      res = await runClaude({
        cwd: ws.cwd,
        prompt: responderPrompt({ shortName: this.shortName, threadId: job.threadId, project: job.project?.name, hub: this.cfg.hub }),
        settings: permissionSettings(),
        timeoutMs: this.opts.timeoutMs ?? 15 * 60 * 1000,
        claudeBin: this.opts.claudeBin,
      });
    } catch (e: any) {
      res = { ok: false, error: String(e?.message ?? e) };
    } finally {
      await ws?.cleanup().catch(() => {});
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "finished", jobId: job.jobId, ok: res.ok, ...(res.ok ? {} : { error: res.error }) }));
    }
    log(`задание ${job.jobId} (ветка #${job.threadId}): ${res.ok ? "готово" : "ошибка — " + res.error}`);
    this.busy = false;
    void this.pump();
  }
}
