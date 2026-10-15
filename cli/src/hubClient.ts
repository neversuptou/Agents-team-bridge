import type { CliConfig } from "./config.js";
import { checkHubUrl, hubFetch } from "./http.js";

// REST хаба (регистрация, профиль, отзыв токена) с проверкой сертификата команды
export const hubClient = (cfg: CliConfig) => {
  const f = hubFetch(cfg.ca);
  const call = async <T>(method: string, path: string, body?: unknown, auth = true): Promise<T> => {
    const r = await f(new URL(path, checkHubUrl(cfg.hub)).toString(), {
      method,
      headers: { ...(auth ? { authorization: `Bearer ${cfg.token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    });
    const data: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.message ?? `Хаб ответил ${r.status}`);
    return data as T;
  };
  return {
    get: <T>(path: string) => call<T>("GET", path),
    post: <T>(path: string, body?: unknown, auth = true) => call<T>("POST", path, body ?? {}, auth),
  };
};
