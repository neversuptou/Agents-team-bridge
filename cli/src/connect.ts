import { readFileSync, writeFileSync, existsSync, appendFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { SelfCmd } from "./self.js";

// TeamBridge подключается только к папке проекта: запись в её .mcp.json, глобальные настройки Claude не трогаются
const file = (dir: string) => join(dir, ".mcp.json");
const read = (dir: string) => (existsSync(file(dir)) ? JSON.parse(readFileSync(file(dir), "utf8")) : {});

export function connectProject(dir: string, self: SelfCmd) {
  const cur = read(dir);
  const next = { ...cur, mcpServers: { ...(cur.mcpServers ?? {}), teambridge: { type: "stdio", command: self.node, args: [self.script, "mcp"] } } };
  writeFileSync(file(dir), JSON.stringify(next, null, 2) + "\n");
  // путь к программе свой на каждой машине — в репозиторий не коммитим
  const exclude = join(dir, ".git", "info", "exclude");
  if (existsSync(join(dir, ".git", "info"))) {
    const has = existsSync(exclude) && readFileSync(exclude, "utf8").split(/\r?\n/).includes(".mcp.json");
    if (!has) appendFileSync(exclude, "\n.mcp.json\n");
  }
}

export function disconnectProject(dir: string) {
  if (!existsSync(file(dir))) return;
  const cur = read(dir);
  const { teambridge: _, ...rest } = cur.mcpServers ?? {};
  if (!Object.keys(rest).length && Object.keys(cur).length <= 1) return rmSync(file(dir));
  writeFileSync(file(dir), JSON.stringify({ ...cur, mcpServers: rest }, null, 2) + "\n");
}
