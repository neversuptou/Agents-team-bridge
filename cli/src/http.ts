import { readFileSync } from "node:fs";
import { Agent, fetch as undiciFetch } from "undici";

// Запросы к хабу: по https доверяем только сертификату центра команды (~/.teambridge/ca.crt), открытый http — только локально
export function checkHubUrl(hub: string) {
  const u = new URL(hub);
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
  if (u.protocol !== "https:" && !local) throw new Error(`Хаб ${hub} должен быть по https — проверьте адрес`);
  return u;
}

export function hubFetch(caFile?: string): typeof fetch {
  if (!caFile) return fetch;
  const dispatcher = new Agent({ connect: { ca: readFileSync(caFile) } });
  return ((url: any, init: any) => undiciFetch(url, { ...init, dispatcher })) as unknown as typeof fetch;
}
