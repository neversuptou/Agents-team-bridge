import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CliConfig } from "./config.js";
import { quoted, type SelfCmd } from "./self.js";

// Аргументы `claude` для (пере)подключения MCP хаба на уровне пользователя
export function setupCommands(cfg: CliConfig): string[][] {
  const header = cfg.token ? `Authorization: Bearer ${cfg.token}` : `X-Invite-Code: ${cfg.inviteCode}`;
  return [
    ["mcp", "remove", "teambridge", "-s", "user"],
    ["mcp", "add", "--transport", "http", "-s", "user", "teambridge", `${cfg.hub}/mcp`, "-H", header],
  ];
}

export const hookSettingsPatch = (self: SelfCmd) => ({
  hooks: { SessionStart: [{ hooks: [{ type: "command", command: quoted(self, "digest") }] }] },
});

// Добавить хук сводки в настройки Claude Code, не трогая остальное и без дублей
export function mergeSettings(cur: any, patch: any) {
  const out = { ...cur, hooks: { ...(cur.hooks ?? {}) } };
  const list = [...(out.hooks.SessionStart ?? [])];
  const entry = patch.hooks.SessionStart[0];
  const cmd = entry.hooks[0].command;
  if (!list.some((g: any) => g.hooks?.some((h: any) => h.command === cmd))) list.push(entry);
  out.hooks.SessionStart = list;
  return out;
}

export function installHook(self: SelfCmd, home = homedir()) {
  mkdirSync(join(home, ".claude"), { recursive: true });
  const f = join(home, ".claude", "settings.json");
  const cur = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {};
  writeFileSync(f, JSON.stringify(mergeSettings(cur, hookSettingsPatch(self)), null, 2));
}

// Запуск `claude`: напрямую (claude.exe / бинарник), а если это npm-обёртка claude.cmd — через cmd с кавычками
export function runClaudeCli(args: string[]) {
  const direct = spawnSync("claude", args, { stdio: "inherit" });
  if (!direct.error) return direct.status ?? 1;
  if (process.platform !== "win32") throw direct.error;
  const line = ["claude", ...args.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a))].join(" ");
  return spawnSync(line, { stdio: "inherit", shell: true }).status ?? 1;
}

export function applyMcp(cfg: CliConfig) {
  const [remove, add] = setupCommands(cfg);
  runClaudeCli(remove); // нет такого сервера — не ошибка
  if (runClaudeCli(add) !== 0) throw new Error("Не удалось подключить MCP: проверьте, что Claude Code установлен (`claude --version`)");
}
