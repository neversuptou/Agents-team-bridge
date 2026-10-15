import type { SelfCmd } from "./self.js";

export type AutostartSpec = { kind: "schtasks" | "launchd" | "systemd"; files: { path: string; content: string }[]; commands: string[][] };

// Автозапуск ответчика при входе в систему: Windows — планировщик (скрыто, через wscript), macOS — LaunchAgent, Linux — systemd user
export function autostartSpec(platform: NodeJS.Platform, self: SelfCmd, home: string): AutostartSpec {
  if (platform === "win32") {
    const path = `${home}/.teambridge/agent.vbs`;
    const content = `CreateObject("WScript.Shell").Run """${self.node}"" ""${self.script}"" agent", 0, False\r\n`;
    return { kind: "schtasks", files: [{ path, content }], commands: [
      ["schtasks", "/Create", "/F", "/SC", "ONLOGON", "/TN", "TeamBridgeAgent", "/TR", `wscript.exe "${path}"`],
    ] };
  }
  if (platform === "darwin") {
    const path = `${home}/Library/LaunchAgents/ru.evapps.teambridge.plist`;
    const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>ru.evapps.teambridge</string>
  <key>ProgramArguments</key><array><string>${self.node}</string><string>${self.script}</string><string>agent</string></array>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${home}/.teambridge/agent.log</string>
  <key>StandardErrorPath</key><string>${home}/.teambridge/agent.log</string>
</dict></plist>
`;
    return { kind: "launchd", files: [{ path, content }], commands: [["launchctl", "load", "-w", path]] };
  }
  const path = `${home}/.config/systemd/user/teambridge.service`;
  const content = `[Unit]\nDescription=TeamBridge agent\n\n[Service]\nExecStart=${self.node} ${self.script} agent\nRestart=always\nRestartSec=10\n\n[Install]\nWantedBy=default.target\n`;
  return { kind: "systemd", files: [{ path, content }], commands: [
    ["systemctl", "--user", "daemon-reload"], ["systemctl", "--user", "enable", "--now", "teambridge.service"],
  ] };
}
