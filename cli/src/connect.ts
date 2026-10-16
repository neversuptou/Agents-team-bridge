import { readFileSync, writeFileSync, existsSync, appendFileSync, rmSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, isAbsolute, join } from "node:path";
import type { SelfCmd } from "./self.js";

// TeamBridge подключается только к папке проекта: запись в её .mcp.json, глобальные настройки Claude не трогаются
const file = (dir: string) => join(dir, ".mcp.json");
const localSettings = (dir: string) => join(dir, ".claude", "settings.local.json");
const readJson = (path: string) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {});

const git = (dir: string, ...args: string[]) => {
  try { return execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
};

// Запреты для Claude в этом проекте: токен в ~/.teambridge и прямые запросы к хабу —
// иначе Claude, послушавшись чужого сообщения, мог бы отправить что-то в обход окна подтверждения
export function denyRules(hub: string) {
  const host = new URL(hub).hostname;
  return ["Read(~/.teambridge/**)", "Edit(~/.teambridge/**)", "Bash(*.teambridge*)", `Bash(*${host}*)`, `WebFetch(domain:${host})`];
}

function writeDenyRules(dir: string, hub: string) {
  const path = localSettings(dir);
  const cur = readJson(path);
  const deny: string[] = cur.permissions?.deny ?? [];
  const next = { ...cur, permissions: { ...(cur.permissions ?? {}), deny: [...new Set([...deny, ...denyRules(hub)])] } };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(next, null, 2) + "\n");
}

// убираем ровно свои правила (по адресу хаба) и всё про ~/.teambridge; чужие запреты не трогаем
function removeDenyRules(dir: string, hub?: string) {
  const path = localSettings(dir);
  if (!existsSync(path)) return;
  const cur = readJson(path);
  if (!cur.permissions?.deny) return;
  const ours = new Set(hub ? denyRules(hub) : []);
  const deny = cur.permissions.deny.filter((r: string) => !ours.has(r) && !r.includes(".teambridge"));
  writeFileSync(path, JSON.stringify({ ...cur, permissions: { ...cur.permissions, deny } }, null, 2) + "\n");
}

export function connectProject(dir: string, self: SelfCmd, hub: string) {
  // .mcp.json уже в репозитории — туда ушёл бы личный путь к node; пусть человек решит сам
  if (git(dir, "ls-files", "--error-unmatch", ".mcp.json") !== null)
    throw new Error(".mcp.json этой папки лежит в git — не меняю его, чтобы личный путь к программе не попал в репозиторий. "
      + "Подключите вручную: claude mcp add -s local teambridge -- \"" + self.node + "\" \"" + self.script + "\" mcp");
  const cur = readJson(file(dir));
  const next = { ...cur, mcpServers: { ...(cur.mcpServers ?? {}), teambridge: { type: "stdio", command: self.node, args: [self.script, "mcp"] } } };
  writeFileSync(file(dir), JSON.stringify(next, null, 2) + "\n");
  // путь к программе свой на каждой машине — исключаем из git (в worktree .git — файл, путь спрашиваем у git)
  const excludeRel = git(dir, "rev-parse", "--git-path", "info/exclude");
  if (excludeRel) {
    const exclude = isAbsolute(excludeRel) ? excludeRel : join(dir, excludeRel);
    mkdirSync(dirname(exclude), { recursive: true });
    const has = existsSync(exclude) && readFileSync(exclude, "utf8").split(/\r?\n/).includes(".mcp.json");
    if (!has) appendFileSync(exclude, "\n.mcp.json\n");
  }
  writeDenyRules(dir, hub);
}

export function disconnectProject(dir: string, hub?: string) {
  removeDenyRules(dir, hub);
  if (!existsSync(file(dir))) return;
  const cur = readJson(file(dir));
  const { teambridge: _, ...rest } = cur.mcpServers ?? {};
  if (!Object.keys(rest).length && Object.keys(cur).length <= 1) return rmSync(file(dir));
  writeFileSync(file(dir), JSON.stringify({ ...cur, mcpServers: rest }, null, 2) + "\n");
}
