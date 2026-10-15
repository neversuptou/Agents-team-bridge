export interface Config {
  port: number; databaseUrl: string; salt: string;
  maxTurns: number; maxRunsPerHour: number; jobTimeoutMs: number; maxAttempts: number;
}
export function loadConfig(env = process.env): Config {
  const salt = env.TB_SALT ?? "";
  if (!salt && env.NODE_ENV === "production") throw new Error("TB_SALT обязателен");
  return {
    port: Number(env.TB_PORT ?? 8120),
    databaseUrl: env.TB_DATABASE_URL ?? "postgres://tb:tb@localhost:54399/tb_test",
    salt: salt || "dev-salt",
    maxTurns: Number(env.TB_MAX_TURNS ?? 10),
    maxRunsPerHour: Number(env.TB_MAX_RUNS_PER_HOUR ?? 6),
    jobTimeoutMs: Number(env.TB_JOB_TIMEOUT_MS ?? 15 * 60 * 1000),
    maxAttempts: Number(env.TB_MAX_ATTEMPTS ?? 2),
  };
}
