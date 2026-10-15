import { loadConfig } from "./config.js";
import { createPool, migrate } from "./db.js";
import { bootstrapInvite } from "./members.js";
import { purgeOld } from "./threads.js";
import { buildServer } from "./server.js";

const cfg = loadConfig();
const pool = createPool(cfg.databaseUrl);
await migrate(pool);

// Пока участников нет — одноразовое приглашение первого админа в лог сервера (видно только тому, кто на сервере)
const first = await bootstrapInvite(pool, cfg);
if (first) console.log(`TeamBridge: участников нет. Приглашение первого админа (действует ${cfg.inviteTtlHours} ч): ${first}`);

// Срок хранения переписки: раз в час удаляем ветки без активности дольше retentionDays
const purge = () => purgeOld(pool, cfg).catch((e) => console.error("purge:", e.message));
await purge();
setInterval(purge, 60 * 60 * 1000).unref();

const app = await buildServer(pool, cfg);
await app.listen({ port: cfg.port, host: "0.0.0.0" });
