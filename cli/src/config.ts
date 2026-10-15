import { mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ~/.teambridge/config.json: адрес хаба и либо код приглашения (до регистрации), либо токен
export type CliConfig = { hub: string; token?: string; inviteCode?: string };

export const configDir = (home = homedir()) => join(home, ".teambridge");

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
