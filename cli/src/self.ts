import { fileURLToPath } from "node:url";

// Как запустить эту же программу из хука и автозапуска: node + путь к скрипту (не зависит от PATH)
export type SelfCmd = { node: string; script: string };

export function selfCmd(): SelfCmd {
  return { node: process.execPath, script: fileURLToPath(new URL("./index.js", import.meta.url)) };
}

export const quoted = (s: SelfCmd, ...args: string[]) => [`"${s.node}"`, `"${s.script}"`, ...args].join(" ");
