// Подменный claude для тестов ответчика: пишет аргументы и время в FAKE_LOG, ведёт себя по FAKE_MODE
import { appendFileSync } from "node:fs";
const log = process.env.FAKE_LOG;
const mode = process.env.FAKE_MODE ?? "ok";
const delay = Number(process.env.FAKE_DELAY ?? 0);
if (log) appendFileSync(log, JSON.stringify({ at: Date.now(), event: "start", args: process.argv.slice(2), cwd: process.cwd() }) + "\n");
const done = () => { if (log) appendFileSync(log, JSON.stringify({ at: Date.now(), event: "end" }) + "\n"); };
if (mode === "hang") setInterval(() => {}, 1000);
else if (mode === "fail") { process.stderr.write("boom"); done(); process.exit(1); }
else setTimeout(() => { process.stdout.write("ok"); done(); process.exit(0); }, delay);
