import { spawn } from "node:child_process";

// Запуск `claude -p` в рабочей копии с запретами; по таймауту процесс убивается
export function runClaude(a: { cwd: string; prompt: string; settings: object; timeoutMs: number; claudeBin?: string[] }) {
  const [cmd, ...pre] = a.claudeBin ?? ["claude"];
  const args = [...pre, "-p", a.prompt, "--settings", JSON.stringify(a.settings),
    "--permission-mode", "acceptEdits", "--output-format", "text", "--max-turns", "40"];
  return new Promise<{ ok: boolean; error?: string; output: string }>((resolve) => {
    const ch = spawn(cmd, args, { cwd: a.cwd, env: process.env, windowsHide: true });
    let out = "", err = "", settled = false;
    const finish = (r: { ok: boolean; error?: string; output: string }) => { if (!settled) { settled = true; resolve(r); } };
    ch.stdout.on("data", (d) => (out += d));
    ch.stderr.on("data", (d) => (err += d));
    ch.on("error", (e) => finish({ ok: false, error: `не удалось запустить claude: ${e.message}`, output: out }));
    const timer = setTimeout(() => {
      ch.kill();
      finish({ ok: false, error: `превышено время ответа (${Math.max(1, Math.round(a.timeoutMs / 60000))} мин)`, output: out });
    }, a.timeoutMs);
    ch.on("close", (code) => {
      clearTimeout(timer);
      finish(code === 0 ? { ok: true, output: out } : { ok: false, error: (err || out).slice(-500) || `код выхода ${code}`, output: out });
    });
  });
}
