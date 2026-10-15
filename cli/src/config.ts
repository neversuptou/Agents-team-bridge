import { mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ~/.teambridge/config.json: адрес хаба и либо код приглашения (до регистрации), либо токен
export type CliConfig = { hub: string; token?: string; inviteCode?: string };

// TEAMBRIDGE_HOME — своя папка конфига (например, второй ответчик на той же машине для проверки)
export const configDir = (home = homedir()) => process.env.TEAMBRIDGE_HOME ?? join(home, ".teambridge");

export function readConfig(dir = configDir()): CliConfig | null {
  const f = join(dir, "config.json");
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
}

export function writeConfig(cfg: CliConfig, dir = configDir()) {
  mkdirSync(dir, { recursive: true });
  const f = join(dir, "config.json");
  writeFileSync(f, JSON.stringify(cfg, null, 2));
  if (process.platform !== "win32") chmodSync(f, 0o600);
}
