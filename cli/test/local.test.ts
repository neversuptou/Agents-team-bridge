import { test, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { readConfig, writeConfig, configDir } from "../src/config.js";
import { connectProject, disconnectProject } from "../src/connect.js";

const self = { node: "C:/node/node.exe", script: "C:/npm/teambridge/dist/index.js" };

test("конфиг: нет файла — null; запись и чтение; только владелец", () => {
  const dir = mkdtempSync(join(tmpdir(), "tb-cfg-"));
  expect(readConfig(dir)).toBeNull();
  writeConfig({ hub: "https://h:8120", token: "tb_1" }, dir);
  expect(readConfig(dir)).toEqual({ hub: "https://h:8120", token: "tb_1" });
  if (process.platform !== "win32") expect(statSync(join(dir, "config.json")).mode & 0o077).toBe(0);
});

test("конфиг от прежней версии (с унаследованными правами) остаётся доступен после перезаписи", () => {
  const dir = mkdtempSync(join(tmpdir(), "tb-cfg-"));
  writeFileSync(join(dir, "config.json"), JSON.stringify({ hub: "http://old" }));
  writeConfig({ hub: "https://h:8120", token: "tb_2" }, dir);
  writeConfig({ hub: "https://h:8120", token: "tb_3" }, dir);
  expect(readConfig(dir)).toEqual({ hub: "https://h:8120", token: "tb_3" });
});

test("TEAMBRIDGE_HOME переопределяет папку конфига", () => {
  process.env.TEAMBRIDGE_HOME = "/tmp/tb-x";
  try { expect(configDir()).toBe("/tmp/tb-x"); } finally { delete process.env.TEAMBRIDGE_HOME; }
});

const HUB = "https://10.10.140.2:8120";
const gitRepo = () => {
  const dir = mkdtempSync(join(tmpdir(), "tb-proj-"));
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "t@t"); git(dir, "config", "user.name", "t");
  return dir;
};
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const settings = (dir: string) => JSON.parse(readFileSync(join(dir, ".claude", "settings.local.json"), "utf8"));

test("подключение к проекту: только .mcp.json папки, чужие серверы сохраняются, в git не попадает", () => {
  const dir = gitRepo();
  writeFileSync(join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { other: { command: "x" } } }));
  connectProject(dir, self, HUB);
  connectProject(dir, self, HUB);
  const m = JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf8"));
  expect(m.mcpServers.other).toEqual({ command: "x" });
  expect(m.mcpServers.teambridge).toEqual({ type: "stdio", command: self.node, args: [self.script, "mcp"] });
  expect(git(dir, "status", "--porcelain", "--", ".mcp.json")).toBe("");
  const exclude = readFileSync(join(dir, git(dir, "rev-parse", "--git-path", "info/exclude")), "utf8");
  expect(exclude.match(/^\.mcp\.json$/gm)).toHaveLength(1);
  disconnectProject(dir, HUB);
  expect(JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf8")).mcpServers).toEqual({ other: { command: "x" } });
});

test("в git worktree исключение пишется в общий git (там .git — файл)", () => {
  const main = gitRepo();
  writeFileSync(join(main, "a.txt"), "a"); git(main, "add", "."); git(main, "commit", "-qm", "a");
  const wt = join(mkdtempSync(join(tmpdir(), "tb-wt-")), "wt");
  git(main, "worktree", "add", "-q", wt);
  connectProject(wt, self, HUB);
  expect(git(wt, "status", "--porcelain", "--", ".mcp.json")).toBe("");
});

test(".mcp.json уже в git — не трогаем: личный путь к node ушёл бы в репозиторий", () => {
  const dir = gitRepo();
  writeFileSync(join(dir, ".mcp.json"), JSON.stringify({ mcpServers: {} }));
  git(dir, "add", ".mcp.json"); git(dir, "commit", "-qm", "mcp");
  expect(() => connectProject(dir, self, HUB)).toThrow(/в git/);
  expect(JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf8"))).toEqual({ mcpServers: {} });
});

test("Claude в проекте запрещено читать ~/.teambridge и ходить к хабу мимо клиента; чужие правила сохраняются", () => {
  const dir = gitRepo();
  mkdirSync(join(dir, ".claude"));
  writeFileSync(join(dir, ".claude", "settings.local.json"), JSON.stringify({ permissions: { allow: ["Bash(npm test:*)"], deny: ["Bash(rm:*)"] } }));
  connectProject(dir, self, HUB);
  connectProject(dir, self, HUB);
  const s = settings(dir);
  expect(s.permissions.allow).toEqual(["Bash(npm test:*)"]);
  expect(s.permissions.deny).toEqual(expect.arrayContaining(["Bash(rm:*)", "Read(~/.teambridge/**)", "Edit(~/.teambridge/**)", "Bash(*.teambridge*)", "Bash(*10.10.140.2*)", "WebFetch(domain:10.10.140.2)"]));
  expect(new Set(s.permissions.deny).size).toBe(s.permissions.deny.length);
  disconnectProject(dir, HUB);
  expect(settings(dir).permissions.deny).toEqual(["Bash(rm:*)"]);
});

test("отключение удаляет .mcp.json, если там был только TeamBridge", () => {
  const dir = mkdtempSync(join(tmpdir(), "tb-proj-"));
  connectProject(dir, self, HUB);
  disconnectProject(dir, HUB);
  expect(existsSync(join(dir, ".mcp.json"))).toBe(false);
});
