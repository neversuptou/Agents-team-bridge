import type { CliConfig } from "./config.js";

export const hubClient = (cfg: CliConfig) => ({
  async get<T>(path: string): Promise<T> {
    const r = await fetch(cfg.hub + path, { headers: { authorization: `Bearer ${cfg.token}` }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`Хаб ответил ${r.status}: ${await r.text()}`);
    return r.json() as Promise<T>;
  },
});

type Digest = {
  decisions: { summary: string; project: string | null }[];
  needsHuman: { id: number; subject: string }[];
  open: { id: number; subject: string }[];
};

// Текст сводки для хука SessionStart; пусто — если нечего сообщить
export function formatDigest(d: Digest, hub: string): string {
  const lines = [
    ...d.decisions.slice(0, 5).map((x) => `• Итог${x.project ? ` (${x.project})` : ""}: ${x.summary.split("\n")[0]}`),
    ...d.needsHuman.map((x) => `• Нужен человек: #${x.id} ${x.subject}`),
    ...d.open.slice(0, 5).map((x) => `• Идёт переписка: #${x.id} ${x.subject}`),
  ];
  if (!lines.length) return "";
  return ["TeamBridge — что произошло у твоего агента за последние 7 дней:", ...lines,
    `Подробности: инструменты teambridge (inbox, thread, decisions) или ${hub}`].join("\n");
}
