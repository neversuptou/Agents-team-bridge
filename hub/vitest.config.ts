import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { fileParallelism: false, testTimeout: 20000, env: { TB_DATABASE_URL: process.env.TB_DATABASE_URL ?? "postgres://tb:tb@localhost:54399/tb_test" } },
});
