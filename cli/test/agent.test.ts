import { test, expect, afterEach } from "vitest";
import { WebSocketServer } from "ws";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Agent } from "../src/agent.js";

const fake = [process.execPath, fileURLToPath(new URL("./fake-claude.mjs", import.meta.url))];
let wss: WebSocketServer | undefined;
let agent: Agent | undefined;
afterEach(() => { agent?.stop(); wss?.close(); });

function fakeHub() {
  wss = new WebSocketServer({ port: 0 });
  const got: any[] = [];
  let sock: any;
  wss.on("connection", (s) => {
    sock = s;
    s.on("message", (d) => {
      const m = JSON.parse(String(d)); got.push(m);
      if (m.type === "hello") s.send(JSON.stringify({ type: "ready", member: { id: 1, shortName: "Тест" } }));
    });
  });
  return { url: `http://127.0.0.1:${(wss.address() as any).port}`, got, send: (m: any) => sock.send(JSON.stringify(m)) };
}
const until = async (f: () => boolean) => { for (let i = 0; i < 300 && !f(); i++) await new Promise((r) => setTimeout(r, 20)); };
const events = (log: string) => existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];

function start(env: Record<string, string>, timeoutMs = 5000) {
  const hub = fakeHub();
  const root = mkdtempSync(join(tmpdir(), "tb-ag-"));
  const log = join(root, "log.jsonl");
  Object.assign(process.env, { FAKE_LOG: log, FAKE_MODE: "ok", FAKE_DELAY: "0", ...env });
  agent = new Agent({ hub: hub.url, token: "tb_t" }, { root, claudeBin: fake, timeoutMs });
  agent.start();
  return { hub, log, root };
}

test("задание без проекта: запуск claude с инструкцией и запретами, finished ok", async () => {
  const { hub, log } = start({});
  await until(() => hub.got.some((m) => m.type === "hello"));
  expect(hub.got[0]).toEqual({ type: "hello", token: "tb_t" });
  hub.send({ type: "job", jobId: 5, threadId: 9, project: null });
  await until(() => hub.got.some((m) => m.type === "finished"));
  expect(hub.got.find((m) => m.type === "finished")).toEqual({ type: "finished", jobId: 5, ok: true });
  const args: string[] = events(log)[0].args;
  expect(args[0]).toBe("-p");
  expect(args[1]).toContain("thread_id=9");
  expect(args[1]).toContain("Тест");
  expect(JSON.parse(args[args.indexOf("--settings") + 1]).permissions.deny).toContain("Bash(git merge:*)");
});

test("ошибка claude → finished ok:false с текстом", async () => {
  const { hub } = start({ FAKE_MODE: "fail" });
  await until(() => hub.got.some((m) => m.type === "hello"));
  hub.send({ type: "job", jobId: 6, threadId: 1, project: null });
  await until(() => hub.got.some((m) => m.type === "finished"));
  expect(hub.got.find((m) => m.type === "finished")).toMatchObject({ jobId: 6, ok: false, error: expect.stringContaining("boom") });
});

test("таймаут → finished ok:false, процесс убит", async () => {
  const { hub } = start({ FAKE_MODE: "hang" }, 300);
  await until(() => hub.got.some((m) => m.type === "hello"));
  hub.send({ type: "job", jobId: 7, threadId: 1, project: null });
  await until(() => hub.got.some((m) => m.type === "finished"));
  expect(hub.got.find((m) => m.type === "finished")).toMatchObject({ jobId: 7, ok: false, error: expect.stringContaining("время") });
});

test("нет репозитория проекта → finished ok:false, claude не запускался", async () => {
  const { hub, log } = start({});
  await until(() => hub.got.some((m) => m.type === "hello"));
  hub.send({ type: "job", jobId: 8, threadId: 1, project: { name: "fin", localPath: "/no/such/path" } });
  await until(() => hub.got.some((m) => m.type === "finished"));
  expect(hub.got.find((m) => m.type === "finished")).toMatchObject({ jobId: 8, ok: false, error: expect.stringContaining("не найден") });
  expect(events(log)).toEqual([]);
});

test("два задания — строго по очереди", async () => {
  const { hub, log } = start({ FAKE_DELAY: "200" });
  await until(() => hub.got.some((m) => m.type === "hello"));
  hub.send({ type: "job", jobId: 1, threadId: 1, project: null });
  hub.send({ type: "job", jobId: 2, threadId: 2, project: null });
  await until(() => hub.got.filter((m) => m.type === "finished").length === 2);
  const ev = events(log);
  expect(ev.map((e) => e.event)).toEqual(["start", "end", "start", "end"]);
  expect(ev[2].at).toBeGreaterThanOrEqual(ev[1].at);
});

test("переподключается после разрыва", async () => {
  const { hub } = start({});
  await until(() => hub.got.filter((m) => m.type === "hello").length === 1);
  for (const c of wss!.clients) c.terminate();
  await until(() => hub.got.filter((m) => m.type === "hello").length === 2);
  expect(hub.got.filter((m) => m.type === "hello").length).toBe(2);
}, 30000);
