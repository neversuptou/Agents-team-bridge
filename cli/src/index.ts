#!/usr/bin/env node
import { Command } from "commander";
import { copyFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { createHash, X509Certificate } from "node:crypto";
import { join, resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readConfig, writeConfig, configDir, ownerOnly, type CliConfig } from "./config.js";
import { hubClient } from "./hubClient.js";
import { checkHubUrl } from "./http.js";
import { connectProject, disconnectProject } from "./connect.js";
import { createProxy } from "./proxy.js";
import { selfCmd } from "./self.js";

const program = new Command("teambridge").description("TeamBridge — переписка Claude-агентов Evapps по проектам компании");
const need = (): CliConfig => { const c = readConfig(); if (!c) throw new Error("Сначала: teambridge setup --hub <адрес> --ca <файл сертификата>"); return c; };
const needToken = () => { const c = need(); if (!c.token) throw new Error("Сначала зарегистрируйтесь: teambridge register --invite <приглашение> --name <короткое имя>"); return c; };

program.command("setup").description("Указать адрес хаба и сертификат центра команды (сверьте отпечаток с тем, что прислал админ)")
  .requiredOption("--hub <url>", "адрес хаба, например https://10.10.140.2:8120")
  .requiredOption("--ca <file>", "файл сертификата центра команды (teambridge-ca.crt)")
  .action((o) => {
    const hub = checkHubUrl(String(o.hub)).origin;
    const cert = new X509Certificate(readFileSync(o.ca));
    if (!cert.ca) throw new Error("Это не сертификат центра (CA)");
    const ca = join(configDir(), "ca.crt");
    writeConfig({ ...(readConfig() ?? {}), hub, ca });
    copyFileSync(o.ca, ca); ownerOnly(ca);
    console.log(`Хаб: ${hub}\nОтпечаток сертификата SHA-256: ${cert.fingerprint256}\nСверьте его с тем, что прислал админ. Дальше: teambridge register --invite <приглашение> --name <короткое имя>`);
  });

program.command("register").description("Зарегистрироваться по личному одноразовому приглашению")
  .requiredOption("--invite <invite>", "приглашение из ссылки админа (tbi_…)")
  .requiredOption("--name <short>", "короткое имя для обращения, например «Дима»")
  .action(async (o) => {
    const cfg = need();
    const r = await hubClient(cfg).post<{ token: string; member: { fullName: string; shortName: string } }>("/register", { invite: o.invite, shortName: o.name }, false);
    writeConfig({ ...cfg, token: r.token });
    console.log(`Готово: ${r.member.fullName} (${r.member.shortName}). Токен сохранён в ${join(configDir(), "config.json")} (доступ только вам).\nПодключите проект: в папке проекта Evapps выполните teambridge connect`);
  });

program.command("connect [dir]").description("Подключить TeamBridge к папке проекта (.mcp.json этой папки, без глобальных настроек Claude)")
  .action((dir?: string) => {
    const cfg = needToken();
    const path = resolve(dir ?? ".");
    connectProject(path, selfCmd());
    writeConfig({ ...cfg, projects: [...new Set([...(cfg.projects ?? []), path])] });
    console.log(`Подключено: ${path}\nОткройте Claude Code в этой папке и одобрите сервер teambridge. Каждую отправку коллегам вы подтверждаете в отдельном окне.`);
  });

program.command("disconnect [dir]").description("Отключить TeamBridge от папки проекта").action((dir?: string) => {
  const path = resolve(dir ?? ".");
  disconnectProject(path);
  const cfg = readConfig();
  if (cfg) writeConfig({ ...cfg, projects: (cfg.projects ?? []).filter((p) => p !== path) });
  console.log(`Отключено: ${path}`);
});

program.command("mcp").description("Локальный MCP-сервер для Claude Code (запускается из .mcp.json проекта)").action(async () => {
  const cfg = needToken();
  const server = await createProxy({ hub: cfg.hub, token: cfg.token!, ca: cfg.ca });
  await server.connect(new StdioServerTransport());
});

program.command("status").description("Настройки и профиль").action(async () => {
  const cfg = readConfig();
  if (!cfg) return console.log("Не настроено: teambridge setup --hub <адрес> --ca <файл сертификата>");
  const fp = cfg.ca && existsSync(cfg.ca) ? new X509Certificate(readFileSync(cfg.ca)).fingerprint256 : "нет";
  console.log(`Хаб: ${cfg.hub}\nСертификат центра: ${fp}\nТокен: ${cfg.token ? "есть" : "нет"}\nПодключённые папки: ${(cfg.projects ?? []).join(", ") || "нет"}`);
  if (cfg.token) {
    try { console.log(JSON.stringify(await hubClient(cfg).get("/api/me"), null, 2)); }
    catch (e: any) { console.log(`Хаб недоступен или токен отозван: ${e.message}`); }
  }
});

program.command("uninstall").description("Отозвать свой токен, отключить все папки и удалить ~/.teambridge").action(async () => {
  const cfg = readConfig();
  if (cfg?.token) {
    try { await hubClient(cfg).post("/api/me/revoke"); console.log("Токен отозван на хабе."); }
    catch (e: any) { console.log(`Не удалось отозвать токен (${e.message}) — попросите админа отозвать его в веб-ленте.`); }
  }
  for (const p of cfg?.projects ?? []) { disconnectProject(p); console.log(`Отключено: ${p}`); }
  rmSync(configDir(), { recursive: true, force: true });
  console.log("Настройки удалены. Осталось удалить программу: npm rm -g teambridge");
});

// SHA-256 файла для сверки скачанного пакета, чтобы не зависеть от certutil/shasum
program.command("sha256 <file>").description("SHA-256 файла (сверка скачанного пакета)").action((f: string) => {
  console.log(createHash("sha256").update(readFileSync(f)).digest("hex"));
});

program.parseAsync().catch((e) => { console.error(e.message); process.exit(1); });
