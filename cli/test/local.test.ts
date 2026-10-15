import { test, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("подключение к проекту: только .mcp.json папки, чужие серверы сохраняются, в git не попадает", () => {
  const dir = mkdtempSync(join(tmpdir(), "tb-proj-"));
  mkdirSync(join(dir, ".git", "info"), { recursive: true });
  writeFileSync(join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { other: { command: "x" } } }));
  connectProject(dir, self);
  connectProject(dir, self);
  const m = JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf8"));
  expect(m.mcpServers.other).toEqual({ command: "x" });
  expect(m.mcpServers.teambridge).toEqual({ type: "stdio", command: self.node, args: [self.script, "mcp"] });
  const exclude = readFileSync(join(dir, ".git", "info", "exclude"), "utf8");
  expect(exclude.match(/^\.mcp\.json$/gm)).toHaveLength(1);
  disconnectProject(dir);
  expect(JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf8")).mcpServers).toEqual({ other: { command: "x" } });
});

test("отключение удаляет .mcp.json, если там был только TeamBridge", () => {
  const dir = mkdtempSync(join(tmpdir(), "tb-proj-"));
  connectProject(dir, self);
  disconnectProject(dir);
  expect(existsSync(join(dir, ".mcp.json"))).toBe(false);
});
