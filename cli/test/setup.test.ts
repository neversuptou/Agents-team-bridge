import { test, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupCommands, hookSettingsPatch, mergeSettings, installHook } from "../src/setup.js";
import { autostartSpec } from "../src/autostart.js";
import { readConfig, writeConfig } from "../src/config.js";

const self = { node: "C:/node/node.exe", script: "C:/npm/teambridge/dist/index.js" };

test("MCP: до регистрации — код приглашения, после — токен", () => {
  expect(setupCommands({ hub: "http://h:8120", inviteCode: "c" }).at(-1)).toEqual(
    ["mcp", "add", "--transport", "http", "-s", "user", "teambridge", "http://h:8120/mcp", "-H", "X-Invite-Code: c"]);
  expect(setupCommands({ hub: "http://h:8120", token: "tb_x" }).at(-1)).toContain("Authorization: Bearer tb_x");
  expect(setupCommands({ hub: "http://h:8120", token: "tb_x" })[0]).toEqual(["mcp", "remove", "teambridge", "-s", "user"]);
});

test("хук SessionStart добавляется один раз и не трогает чужие", () => {
  const once = mergeSettings({}, hookSettingsPatch(self));
  expect(once.hooks.SessionStart[0].hooks[0].command).toBe('"C:/node/node.exe" "C:/npm/teambridge/dist/index.js" digest');
  expect(mergeSettings(once, hookSettingsPatch(self)).hooks.SessionStart).toHaveLength(1);
  const other = { model: "x", hooks: { SessionStart: [{ hooks: [{ type: "command", command: "other" }] }], Stop: [1] } };
  const merged = mergeSettings(other, hookSettingsPatch(self));
  expect(merged.hooks.SessionStart).toHaveLength(2);
  expect(merged.hooks.Stop).toEqual([1]);
  expect(merged.model).toBe("x");
});

test("installHook пишет в ~/.claude/settings.json, сохраняя прочее", () => {
  const home = mkdtempSync(join(tmpdir(), "tb-home-"));
  mkdirSync(join(home, ".claude"));
  writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ theme: "dark" }));
  installHook(self, home);
  const s = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"));
  expect(s.theme).toBe("dark");
  expect(s.hooks.SessionStart).toHaveLength(1);
});

test("автозапуск: Windows — скрытый лаунчер в папке «Автозагрузка» (без прав администратора)", () => {
  const w = autostartSpec("win32", self, "C:/Users/u");
  expect(w.files[0].path).toBe("C:/Users/u/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup/teambridge-agent.vbs");
  expect(w.files[0].content).toContain("agent");
  expect(w.files[0].content).toContain(", 0, False");
  expect(w.commands).toEqual([["wscript.exe", w.files[0].path]]);
});

test("автозапуск: macOS и Linux", () => {
  const mac = autostartSpec("darwin", { node: "/usr/local/bin/node", script: "/lib/tb/index.js" }, "/Users/u");
  expect(mac.files[0].path).toBe("/Users/u/Library/LaunchAgents/ru.evapps.teambridge.plist");
  expect(mac.files[0].content).toContain("<string>agent</string>");
  expect(mac.files[0].content).toContain("<string>/lib/tb/index.js</string>");
  const lin = autostartSpec("linux", { node: "/usr/bin/node", script: "/lib/tb/index.js" }, "/home/u");
  expect(lin.files[0].path).toBe("/home/u/.config/systemd/user/teambridge.service");
  expect(lin.files[0].content).toContain("ExecStart=/usr/bin/node /lib/tb/index.js agent");
  expect(lin.commands).toContainEqual(["systemctl", "--user", "enable", "--now", "teambridge.service"]);
});

test("конфиг: нет файла — null; запись и чтение", () => {
  const dir = mkdtempSync(join(tmpdir(), "tb-cfg-"));
  expect(readConfig(dir)).toBeNull();
  writeConfig({ hub: "http://h", token: "tb_1" }, dir);
  expect(readConfig(dir)).toEqual({ hub: "http://h", token: "tb_1" });
});
