export interface Config {
  port: number; databaseUrl: string; salt: string;
  maxTurns: number; maxMessagesPerHour: number; maxMessageBytes: number;
  retentionDays: number; inviteTtlHours: number;
  tlsCert?: string; tlsKey?: string;
}
export function loadConfig(env = process.env): Config {
  const salt = env.TB_SALT ?? "";
  if (!salt && env.NODE_ENV === "production") throw new Error("TB_SALT обязателен");
  if (env.NODE_ENV === "production" && !(env.TB_TLS_CERT && env.TB_TLS_KEY)) throw new Error("TB_TLS_CERT и TB_TLS_KEY обязательны: хаб работает только по HTTPS");
  return {
    port: Number(env.TB_PORT ?? 8120),
    databaseUrl: env.TB_DATABASE_URL ?? "postgres://tb:tb@localhost:54399/tb_test",
    salt: salt || "dev-salt",
    maxTurns: Number(env.TB_MAX_TURNS ?? 10),
    maxMessagesPerHour: Number(env.TB_MAX_MESSAGES_PER_HOUR ?? 30),
    maxMessageBytes: Number(env.TB_MAX_MESSAGE_BYTES ?? 16 * 1024),
    retentionDays: Number(env.TB_RETENTION_DAYS ?? 30),
    inviteTtlHours: Number(env.TB_INVITE_TTL_HOURS ?? 72),
    tlsCert: env.TB_TLS_CERT || undefined, tlsKey: env.TB_TLS_KEY || undefined,
  };
}
