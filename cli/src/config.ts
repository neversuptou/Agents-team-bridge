import { mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";

// ~/.teambridge/config.json: адрес хаба, токен, путь к сертификату центра команды и подключённые папки
export type CliConfig = { hub: string; token?: string; ca?: string; projects?: string[] };

// TEAMBRIDGE_HOME — своя папка конфига (например, второй участник на той же машине для проверки)
export const configDir = (home = homedir()) => process.env.TEAMBRIDGE_HOME ?? join(home, ".teambridge");

export function readConfig(dir = configDir()): CliConfig | null {
  const f = join(dir, "config.json");
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
}

// Права только для владельца: chmod на Unix, ACL без наследования на Windows
export function ownerOnly(path: string) {
  if (process.platform !== "win32") return chmodSync(path, statSync(path).isDirectory() ? 0o700 : 0o600);
  // папке — с наследованием (OI)(CI), иначе файлы внутри останутся вовсе без прав
  const who = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${userInfo().username}` : userInfo().username;
  const rights = statSync(path).isDirectory() ? "(OI)(CI)F" : "F";
  spawnSync("icacls", [path, "/inheritance:r", "/grant:r", `${who}:${rights}`], { stdio: "ignore" });
}

export function writeConfig(cfg: CliConfig, dir = configDir()) {
  mkdirSync(dir, { recursive: true });
  ownerOnly(dir);
  const f = join(dir, "config.json");
  writeFileSync(f, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  ownerOnly(f);
}
