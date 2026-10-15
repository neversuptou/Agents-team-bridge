// Сквозная проверка против локального хаба: регистрирует Анну и Бориса, запускает ответчик Бориса
// (настоящий claude -p под подпиской пользователя) и задаёт ему вопросы от имени Анны.
// Запуск: node scripts/e2e.mjs <hub> <invite>   (хаб — локальный, НЕ боевой)
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [hub = "http://127.0.0.1:8121", invite = "e2ecode"] = process.argv.slice(2);
const root = mkdtempSync(join(tmpdir(), "tb-e2e-"));
const sfx = Math.random().toString(36).slice(2, 6);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function mcp(auth, name, args) {
  const r = await fetch(hub + "/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...auth },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const j = await r.json();
  const text = j.result.content[0].text;
  if (j.result.isError) throw new Error(text);
  return JSON.parse(text);
}

// песочница-репозиторий проекта Бориса с bare-origin
const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();
const origin = join(root, "origin.git");
git(root, "init", "--bare", "-b", "main", origin);
const repo = join(root, "tb-sandbox");
git(root, "clone", origin, repo);
git(repo, "config", "user.email", "e2e@local"); git(repo, "config", "user.name", "e2e");
writeFileSync(join(repo, "README.md"), "# Песочница\n");
writeFileSync(join(repo, "notes.txt"), "раз\nдва\nтри\n");
git(repo, "add", "."); git(repo, "commit", "-m", "init"); git(repo, "push", "-u", "origin", "main");

const anna = await mcp({ "X-Invite-Code": invite }, "register", { full_name: "Анна Тестова", short_name: `Анна-${sfx}` });
const boris = await mcp({ "X-Invite-Code": invite }, "register", {
  full_name: "Борис Тестов", short_name: `Борис-${sfx}`, projects: [{ name: `tb-sandbox-${sfx}`, local_path: repo }],
});
log("зарегистрированы Анна и Борис");

// ответчик Бориса со своим «домом»
const tbHome = join(root, "tb-boris"); // своя папка конфига; вход в Claude — настоящий
mkdirSync(tbHome, { recursive: true });
writeFileSync(join(tbHome, "config.json"), JSON.stringify({ hub, token: boris.token }));
const agent = spawn(process.execPath, [join(process.cwd(), "cli", "dist", "index.js"), "agent"], {
  env: { ...process.env, TEAMBRIDGE_HOME: tbHome }, stdio: ["ignore", "pipe", "pipe"],
});
agent.stdout.on("data", (d) => process.stdout.write("  [агент Бориса] " + d));
agent.stderr.on("data", (d) => process.stdout.write("  [агент Бориса!] " + d));

const A = { authorization: `Bearer ${anna.token}` };
async function waitClosed(threadId, label, limitMs = 10 * 60 * 1000) {
  const t0 = Date.now();
  while (Date.now() - t0 < limitMs) {
    const t = await mcp(A, "thread", { thread_id: threadId });
    if (t.status === "closed" || t.status === "needs_human" || t.messages.length >= 2 && !t.messages.at(-1).author.startsWith("Анна") && t.status === "waiting") {
      log(`${label}: статус ${t.status}, сообщений ${t.messages.length}, за ${Math.round((Date.now() - t0) / 1000)} с`);
      for (const m of t.messages) log(`  ${m.author}: ${m.text.slice(0, 300).replace(/\n/g, " ⏎ ")}`, m.actions?.length ? JSON.stringify(m.actions) : "");
      if (t.decision) log(`  ИТОГ: ${t.decision.slice(0, 300)}`);
      return t;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`${label}: нет ответа за ${limitMs / 60000} мин`);
}

try {
  // 1. Текстовый вопрос по проекту: ответить и записать итог
  const q1 = await mcp(A, "ask", { project: `tb-sandbox-${sfx}`, subject: "Сколько строк в notes.txt",
    text: "Сколько строк в файле notes.txt в корне tb-sandbox? Ответь числом и закрой ветку итогом через decide." });
  log("вопрос 1 → ветка", q1.threadId, "адресат", q1.recipientShortName);
  await waitClosed(q1.threadId, "Вопрос 1");

  // 2. Правка кода: своя ветка agent/*, main не меняется
  const q2 = await mcp(A, "ask", { project: `tb-sandbox-${sfx}`, subject: "Добавить HELLO",
    text: "Добавь файл HELLO.md с текстом «привет», закоммить и запушь свою ветку agent/*. MR не нужен (это песочница без GitLab). В ответе укажи имя ветки и закрой ветку итогом." });
  log("вопрос 2 → ветка", q2.threadId);
  await waitClosed(q2.threadId, "Вопрос 2");
  log("ветки в origin:", git(origin, "branch", "--list").replace(/\n/g, ", "));
  log("main в origin:", git(origin, "log", "--oneline", "main").replace(/\n/g, " | "));
  const agentBranch = git(origin, "branch", "--list", "agent/*").replace(/[* ]/g, "").split("\n")[0];
  if (agentBranch) log("файлы в", agentBranch, ":", git(origin, "ls-tree", "--name-only", agentBranch).replace(/\n/g, ", "));
  log("журнал решений:", JSON.stringify((await mcp(A, "decisions", { project: `tb-sandbox-${sfx}` })).map((d) => d.summary.slice(0, 120))));
} finally {
  agent.kill();
  log("каталог проверки:", root);
}
