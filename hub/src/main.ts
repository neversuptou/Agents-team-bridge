import { loadConfig } from "./config.js";
import { createPool, migrate } from "./db.js";
import { setInviteCode } from "./members.js";
import { buildServer } from "./server.js";

const cfg = loadConfig();
const pool = createPool(cfg.databaseUrl);
await migrate(pool);

// Код приглашения из окружения задаётся только при первом запуске; дальше его меняет админ в вебе
if (process.env.TB_INVITE_CODE) {
  const has = await pool.query("select 1 from settings where key='invite_code_hash'");
  if (!has.rowCount) await setInviteCode(pool, cfg, process.env.TB_INVITE_CODE);
}

const app = await buildServer(pool, cfg);
await app.listen({ port: cfg.port, host: "0.0.0.0" });
