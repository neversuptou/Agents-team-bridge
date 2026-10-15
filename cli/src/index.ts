#!/usr/bin/env node
import { Command } from "commander";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { readConfig, writeConfig, configDir } from "./config.js";
import { Agent } from "./agent.js";
import { applyMcp, installHook } from "./setup.js";
import { autostartSpec } from "./autostart.js";
import { hubClient, formatDigest } from "./hubClient.js";
import { selfCmd } from "./self.js";

const program = new Command("teambridge").description("TeamBridge — общий канал Claude-агентов команды");

program.command("setup").description("Подключить Claude Code к хабу, поставить сводку при старте и автозапуск ответчика")
  .requiredOption("--hub <url>", "адрес хаба, например http://10.10.140.2:8120")
  .requiredOption("--invite <code>", "код приглашения команды")
  .action((o) => {
    const cfg = { hub: String(o.hub).replace(/\/$/, ""), inviteCode: String(o.invite) };
    writeConfig(cfg);
    applyMcp(cfg);
    const self = selfCmd();
    installHook(self);
    const spec = autostartSpec(process.platform, self, homedir());
    for (const f of spec.files) { mkdirSync(dirname(f.path), { recursive: true }); writeFileSync(f.path, f.content); }
    for (const c of spec.commands) spawnSync(c[0], c.slice(1), { stdio: "inherit" });
    if (process.platform === "win32") spawnSync("schtasks", ["/Run", "/TN", "TeamBridgeAgent"], { stdio: "ignore" });
    console.log("\nГотово. Откройте (или перезапустите) Claude Code и скажите: «Зарегистрируй меня в TeamBridge».");
  });

program.command("save-token <token>").description("Сохранить персональный токен после регистрации")
  .action((token: string) => {
    const cfg = readConfig();
    if (!cfg) throw new Error("Сначала выполните teambridge setup");
    const next = { hub: cfg.hub, token };
    writeConfig(next);
    applyMcp(next);
    console.log("Токен сохранён. Перезапустите Claude Code; ответчик подхватит токен в течение минуты.");
  });

program.command("digest").description("Сводка для хука при старте Claude Code").action(async () => {
  const cfg = readConfig();
  if (!cfg?.token) return;
  try {
    const text = formatDigest(await hubClient(cfg).get("/api/digest"), cfg.hub);
    if (text) console.log(text);
  } catch { /* хаб недоступен — старт сессии не ломаем */ }
});

program.command("status").description("Настройки и профиль").action(async () => {
  const cfg = readConfig();
  if (!cfg) return console.log("Не настроено: teambridge setup --hub <адрес> --invite <код>");
  console.log(`Хаб: ${cfg.hub}\nТокен: ${cfg.token ? "есть" : "нет — зарегистрируйтесь через Claude"}`);
  if (cfg.token) console.log(JSON.stringify(await hubClient(cfg).get("/api/me"), null, 2));
});

program.command("agent").description("Ответчик: отвечает в TeamBridge от вашего имени (запускается автоматически при входе)")
  .action(async () => {
    // при автозапуске окна нет — пишем лог в ~/.teambridge/agent.log
    const logFile = join(configDir(), "agent.log");
    mkdirSync(configDir(), { recursive: true });
    const write = console.log;
    console.log = (...a: unknown[]) => { write(...a); appendFileSync(logFile, a.join(" ") + "\n"); };
    // до регистрации токена нет — ждём, проверяя конфиг раз в минуту
    let cfg = readConfig();
    while (!cfg?.token) {
      console.log("Ответчик ждёт регистрации (нет токена в ~/.teambridge/config.json)…");
      await new Promise((r) => setTimeout(r, 60_000));
      cfg = readConfig();
    }
    new Agent(cfg, { root: configDir() }).start();
  });

program.parseAsync().catch((e) => { console.error(e.message); process.exit(1); });
