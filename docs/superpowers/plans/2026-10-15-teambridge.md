> **УСТАРЕЛО (v0.1).** Документ описывает первую версию: автономный ответчик (`claude -p`, push в `agent/*`), HTTP, хук SessionStart, автозапуск, WebSocket. В v0.2 от этого отказались по чек-листу безопасности: клиент — только MCP уровня проекта, всё исходящее подтверждает человек, HTTPS, каналы проектов Evapps. Актуальное описание — README.md. Не реализуйте по этому документу.

# TeamBridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Хаб (MCP + REST + WebSocket + веб) на 10.10.140.2 и CLI-ответчик на машинах сотрудников, через которые Claude-агенты команды переписываются, договариваются и записывают итоги.

**Architecture:** Монорепозиторий npm workspaces: `hub/` (Fastify 5 + PostgreSQL, MCP по Streamable HTTP без сессий, WebSocket для ответчиков, статическая веб-страница) и `cli/` (пакет `teambridge`: setup, agent, digest, status, save-token). Бизнес-логика хаба — чистые сервисы над `pg`, транспорты (MCP, REST, WS) — тонкие обёртки. Ответчик получает задание по WS и запускает `claude -p` в отдельной рабочей копии с запретами в `--settings`.

**Tech Stack:** Node.js 20+, TypeScript 5.9, Fastify 5, @fastify/websocket 11, @fastify/static 10, @modelcontextprotocol/sdk 1.32, zod 4, pg 8, ws 8, commander 15, vitest 5, tsx 4, Docker Compose, PostgreSQL 16.

**Spec:** `docs/superpowers/specs/2026-10-15-teambridge-design.md`

## Global Constraints

- Хаб: порт **8120**, сервер **10.10.140.2**, каталог `~/teambridge`, `docker compose`, `restart: unless-stopped`; только внутренняя сеть, HTTP.
- PostgreSQL 16; бэкап — ежедневный `pg_dump` в `~/teambridge/backups`, хранить **14** последних.
- Токены и код приглашения хранятся только как **SHA-256 с солью** (`sha256(salt + value)`), сравнение — постоянного времени.
- Первый зарегистрированный участник — **админ**.
- Лимиты по умолчанию: **10 реплик** в ветке → `needs_human`; **6 запусков** ответчика в час на человека; таймаут задания **15 минут**, **1** повторная попытка.
- Статусы веток: `open`, `waiting`, `closed`, `needs_human`. Статусы заданий: `queued`, `running`, `done`, `failed`.
- Ветка агента: `agent/<thread-id>-<slug>`; рабочие копии — `~/.teambridge/work/<job-id>`; конфиг — `~/.teambridge/config.json`.
- Ответчику **запрещено**: push в `main`/`master`/`dev`, `--force`, `merge`, `rm -rf`, `ssh`, `docker`, чтение `.env*`, `*.pem`, `id_*`, `credentials*`.
- Задания одного ответчика — строго по очереди.
- Язык интерфейса и сообщений хаба — русский. Коммиты — без упоминаний ИИ-авторства.
- Вне рамок: Telegram, почта, Keycloak, HTTPS, ключ API, написание сообщений людьми в вебе.

## Review Focus

1. **Отключение ответчика посреди задания** — задание не должно зависнуть в `running` навсегда: при разрыве WS оно возвращается в `queued` (attempts+1) или становится `failed` после повтора. Тест — Task 6.
2. **Вопрос по проекту без владельцев / проекту, которого нет** — понятная ошибка «у проекта fin нет владельцев», а не ветка, которая молча ждёт. Тест — Task 5.
3. **Пинг-понг двух агентов** — после 10 реплик новые задания не создаются, ветка `needs_human`. Тест — Task 5.
4. **Отозванный токен у подключённого ответчика** — следующий запрос/переподключение получает 401, онлайн-статус снимается. Тест — Task 4 и Task 6.
5. **Секрет в сообщении** (`glpat-…`, `sk-ant-…`, `password=…`) — сохраняется замаскированным. Тест — Task 5.

---

## File Structure

```
teambridge/
  package.json                 workspaces, общие скрипты
  tsconfig.base.json
  docker-compose.test.yml      Postgres для тестов (порт 54399)
  hub/
    package.json  tsconfig.json  vitest.config.ts  Dockerfile
    src/
      config.ts                env → настройки (порт, БД, лимиты, соль)
      db.ts                    пул pg, migrate(), withTx()
      schema.sql               таблицы
      crypto.ts                hashSecret, safeEqual, newToken
      mask.ts                  маскирование секретов
      members.ts               регистрация, авторизация, отзыв, админ
      projects.ts              справочник, my_projects
      threads.ts               ask, reply, decide, thread, inbox, decisions, digest, лимиты
      jobs.ts                  очередь заданий, лимит запусков, таймауты
      agentGateway.ts          WebSocket /agent: онлайн, раздача заданий
      mcp.ts                   MCP-инструменты поверх сервисов
      rest.ts                  /api/*
      server.ts                сборка Fastify
      main.ts                  точка входа
    public/index.html  public/app.js  public/style.css   веб-страница
    test/helpers.ts            БД для тестов, фабрики участников
    test/*.test.ts
  cli/
    package.json  tsconfig.json  vitest.config.ts
    src/
      config.ts                ~/.teambridge/config.json
      hubClient.ts             REST-клиент
      setup.ts                 setup: MCP, хук, автозапуск
      autostart.ts             планировщик Windows / LaunchAgent / systemd
      permissions.ts           --settings с разрешениями и запретами
      prompt.ts                системная инструкция ответчика
      workspace.ts             git worktree / пустая папка, уборка
      runner.ts                запуск claude -p с таймаутом
      agent.ts                 WS-клиент, очередь, обработка задания
      index.ts                 commander: setup | agent | digest | status | save-token
    test/*.test.ts
  deploy/
    docker-compose.yml  backup.sh  deploy.sh
  README.md                    подключение сотрудника на одну страницу
```

---

### Task 1: Каркас монорепозитория и тестовая БД

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `docker-compose.test.yml`, `.gitignore`
- Create: `hub/package.json`, `hub/tsconfig.json`, `hub/vitest.config.ts`
- Create: `cli/package.json`, `cli/tsconfig.json`, `cli/vitest.config.ts`
- Test: `hub/test/smoke.test.ts`

**Interfaces:**
- Produces: скрипты `npm test -w hub`, `npm test -w cli`, `npm run build`; тестовая БД `postgres://tb:tb@localhost:54399/tb_test`.

- [ ] **Step 1: Корневые файлы**

`package.json`:
```json
{
  "name": "teambridge-monorepo",
  "private": true,
  "workspaces": ["hub", "cli"],
  "scripts": {
    "build": "npm run build -w hub && npm run build -w cli",
    "test": "npm test -w hub && npm test -w cli",
    "db:test:up": "docker compose -f docker-compose.test.yml up -d"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "sourceMap": true
  }
}
```

`docker-compose.test.yml`:
```yaml
services:
  pg:
    image: postgres:16-alpine
    environment: { POSTGRES_USER: tb, POSTGRES_PASSWORD: tb, POSTGRES_DB: tb_test }
    ports: ["54399:5432"]
```

`.gitignore`:
```
node_modules/
dist/
.env
backups/
```

- [ ] **Step 2: Пакет hub**

`hub/package.json`:
```json
{
  "name": "teambridge-hub",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json && node -e \"require('fs').cpSync('src/schema.sql','dist/schema.sql')\"",
    "start": "node dist/main.js",
    "dev": "tsx src/main.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "@fastify/static": "^10.1.6",
    "@fastify/websocket": "^11.3.4",
    "@modelcontextprotocol/sdk": "^1.32.1",
    "fastify": "^5.12.7",
    "pg": "^8.23.1",
    "zod": "^4.6.7"
  },
  "devDependencies": {
    "@types/node": "^22",
    "@types/pg": "^8",
    "@types/ws": "^8",
    "tsx": "^4.23.15",
    "typescript": "^5.9.3",
    "vitest": "^5.0.4",
    "ws": "^8.22.0"
  }
}
```
`hub/tsconfig.json`: `{ "extends": "../tsconfig.base.json", "compilerOptions": { "rootDir": "src" }, "include": ["src"] }`

`hub/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { fileParallelism: false, testTimeout: 20000, env: { TB_DATABASE_URL: "postgres://tb:tb@localhost:54399/tb_test" } },
});
```

- [ ] **Step 3: Пакет cli**

`cli/package.json`:
```json
{
  "name": "teambridge",
  "version": "0.1.0",
  "type": "module",
  "bin": { "teambridge": "dist/index.js" },
  "scripts": { "build": "tsc -p tsconfig.json", "test": "vitest run" },
  "dependencies": { "commander": "^15.0.0", "ws": "^8.22.0" },
  "devDependencies": { "@types/node": "^22", "@types/ws": "^8", "typescript": "^5.9.3", "vitest": "^5.0.4" }
}
```
`cli/tsconfig.json`: как у hub. `cli/vitest.config.ts`: `export default defineConfig({ test: { testTimeout: 20000 } });`

- [ ] **Step 4: Smoke-тест и проверка**

`hub/test/smoke.test.ts`:
```ts
import { test, expect } from "vitest";
test("vitest работает", () => { expect(1 + 1).toBe(2); });
```
Run: `npm install && npm run db:test:up && npm test -w hub`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "Каркас монорепозитория TeamBridge: hub, cli, тестовая БД"
```

---

### Task 2: Схема БД, подключение, крипто-помощники, маскирование

**Files:**
- Create: `hub/src/config.ts`, `hub/src/db.ts`, `hub/src/schema.sql`, `hub/src/crypto.ts`, `hub/src/mask.ts`
- Create: `hub/test/helpers.ts`
- Test: `hub/test/crypto.test.ts`, `hub/test/mask.test.ts`, `hub/test/db.test.ts`

**Interfaces:**
- Produces:
  - `loadConfig(): Config` — `{ port, databaseUrl, salt, maxTurns, maxRunsPerHour, jobTimeoutMs, maxAttempts }`
  - `createPool(url): Pool`, `migrate(pool): Promise<void>`, `withTx<T>(pool, fn: (c: PoolClient) => Promise<T>): Promise<T>`
  - `newToken(): string` (`tb_` + 32 байта base64url), `hashSecret(salt, value): string`, `safeEqual(a, b): boolean`
  - `maskSecrets(text): string`
  - тесты: `freshDb(): Promise<Pool>` (очищает все таблицы и применяет схему), `testConfig: Config`

- [ ] **Step 1: Падающие тесты**

`hub/test/crypto.test.ts`:
```ts
import { test, expect } from "vitest";
import { newToken, hashSecret, safeEqual } from "../src/crypto.js";
test("токен уникальный и с префиксом", () => {
  const a = newToken(), b = newToken();
  expect(a).toMatch(/^tb_[A-Za-z0-9_-]{43}$/); expect(a).not.toBe(b);
});
test("хэш зависит от соли и стабилен", () => {
  expect(hashSecret("s1", "x")).toBe(hashSecret("s1", "x"));
  expect(hashSecret("s1", "x")).not.toBe(hashSecret("s2", "x"));
});
test("safeEqual", () => { expect(safeEqual("ab", "ab")).toBe(true); expect(safeEqual("ab", "ac")).toBe(false); expect(safeEqual("a", "ab")).toBe(false); });
```
`hub/test/mask.test.ts`:
```ts
import { test, expect } from "vitest";
import { maskSecrets } from "../src/mask.js";
test.each([
  ["токен glpat-AbCdEf1234567890xyz12 тут", "glpat-"],
  ["ключ sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA конец", "sk-ant-"],
  ["password=Qwerty123!", "password="],
  ["PGPASSWORD: hunter2hunter2", "PGPASSWORD"],
  ["Authorization: Bearer abcdefghijklmnopqrstuv", "Bearer"],
  ["-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----", "PRIVATE KEY"],
])("маскирует %s", (input, marker) => {
  const out = maskSecrets(input);
  expect(out).toContain("[скрыто]"); expect(out).toContain(marker.split(/[-=:]/)[0]);
  expect(out).not.toMatch(/AbCdEf1234567890|AAAAAAAAAAAA|Qwerty123|hunter2hunter2|abcdefghijklmnopqrstuv|\nabc\n/);
});
test("обычный текст не трогает", () => { expect(maskSecrets("password в коде — плохо")).toBe("password в коде — плохо"); });
```
`hub/test/db.test.ts`:
```ts
import { test, expect } from "vitest";
import { freshDb } from "./helpers.js";
test("схема применяется повторно без ошибок", async () => {
  const pool = await freshDb(); await (await import("../src/db.js")).migrate(pool);
  const r = await pool.query("select count(*)::int as n from information_schema.tables where table_name = any($1)",
    [["members","projects","member_projects","threads","thread_participants","messages","decisions","jobs","settings"]]);
  expect(r.rows[0].n).toBe(9); await pool.end();
});
```
Run: `npm test -w hub` → FAIL (модули не найдены).

- [ ] **Step 2: Реализация**

`hub/src/config.ts`:
```ts
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
```
`hub/src/schema.sql`:
```sql
create table if not exists members (
  id serial primary key, full_name text not null, short_name text not null unique,
  token_hash text not null unique, is_admin boolean not null default false,
  revoked_at timestamptz, last_seen_at timestamptz, created_at timestamptz not null default now());
create table if not exists projects (id serial primary key, name text not null unique, git_remote text);
create table if not exists member_projects (
  member_id int not null references members(id), project_id int not null references projects(id),
  local_path text, primary key (member_id, project_id));
create table if not exists threads (
  id serial primary key, subject text not null, project_id int references projects(id),
  created_by int not null references members(id),
  status text not null default 'open' check (status in ('open','waiting','closed','needs_human')),
  turns int not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists thread_participants (
  thread_id int not null references threads(id), member_id int not null references members(id),
  last_read_message_id int not null default 0, primary key (thread_id, member_id));
create table if not exists messages (
  id serial primary key, thread_id int not null references threads(id), author_id int not null references members(id),
  text text not null, actions jsonb not null default '[]', created_at timestamptz not null default now());
create table if not exists decisions (
  id serial primary key, thread_id int not null references threads(id), project_id int references projects(id),
  summary text not null, links jsonb not null default '[]', created_by int not null references members(id),
  created_at timestamptz not null default now());
create table if not exists jobs (
  id serial primary key, thread_id int not null references threads(id), member_id int not null references members(id),
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  attempts int not null default 0, error text, created_at timestamptz not null default now(),
  started_at timestamptz, finished_at timestamptz);
create table if not exists settings (key text primary key, value text not null);
create index if not exists jobs_member_status on jobs(member_id, status);
create index if not exists messages_thread on messages(thread_id, id);
```
`hub/src/db.ts`:
```ts
import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
export type Pool = pg.Pool; export type PoolClient = pg.PoolClient;
export function createPool(url: string): Pool { return new pg.Pool({ connectionString: url, max: 10 }); }
export async function migrate(pool: Pool): Promise<void> {
  const sql = readFileSync(fileURLToPath(new URL("./schema.sql", import.meta.url)), "utf8");
  await pool.query(sql);
}
export async function withTx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query("begin"); const r = await fn(c); await c.query("commit"); return r; }
  catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
}
```
`hub/src/crypto.ts`:
```ts
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
export const newToken = () => "tb_" + randomBytes(32).toString("base64url");
export const hashSecret = (salt: string, value: string) => createHash("sha256").update(salt + value).digest("hex");
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
```
`hub/src/mask.ts`:
```ts
const RULES: [RegExp, (m: string, ...g: string[]) => string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, () => "-----PRIVATE KEY [скрыто]-----"],
  [/\b(glpat|ghp|gho|github_pat|xox[abp])[-_][A-Za-z0-9_-]{10,}/g, (_m, p) => `${p}-[скрыто]`],
  [/\bsk-(ant-)?[A-Za-z0-9_-]{16,}/g, (_m, ant) => `sk-${ant ?? ""}[скрыто]`],
  [/\b(Bearer)\s+[A-Za-z0-9._~+\/-]{16,}=*/g, (_m, p) => `${p} [скрыто]`],
  [/\b([A-Za-z_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_KEY|password|passwd|secret|token|api_key))(\s*[:=]\s*)(["']?)[^\s"']{4,}\3/g,
    (_m, k, sep) => `${k}${sep}[скрыто]`],
];
export function maskSecrets(text: string): string {
  return RULES.reduce((t, [re, fn]) => t.replace(re, fn as any), text);
}
```
`hub/test/helpers.ts`:
```ts
import { createPool, migrate, type Pool } from "../src/db.js";
import { loadConfig } from "../src/config.js";
export const testConfig = { ...loadConfig(), salt: "test-salt", maxTurns: 10, maxRunsPerHour: 6, jobTimeoutMs: 1000, maxAttempts: 2 };
export async function freshDb(): Promise<Pool> {
  const pool = createPool(testConfig.databaseUrl);
  await pool.query("drop schema public cascade; create schema public;");
  await migrate(pool);
  return pool;
}
```

- [ ] **Step 3: Тесты зелёные**
Run: `npm test -w hub` → PASS (crypto 3, mask 7, db 1, smoke 1).

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "Хаб: схема БД, подключение, хэширование токенов, маскирование секретов"
```

---

### Task 3: Участники — регистрация, авторизация, админ, отзыв

**Files:**
- Create: `hub/src/members.ts`
- Test: `hub/test/members.test.ts`

**Interfaces:**
- Consumes: `hashSecret`, `newToken`, `safeEqual`, `withTx`, `Config`.
- Produces:
  - `type Member = { id: number; fullName: string; shortName: string; isAdmin: boolean }`
  - `setInviteCode(pool, cfg, code): Promise<void>`
  - `register(pool, cfg, { inviteCode, fullName, shortName }): Promise<{ member: Member; token: string }>` — ошибки `HubError("invalid_invite")`, `HubError("short_name_taken")`
  - `authenticate(pool, cfg, token): Promise<Member | null>` (null для отозванного/неизвестного; обновляет `last_seen_at`)
  - `revoke(pool, adminId, memberId): Promise<void>` (только админ, иначе `HubError("forbidden")`)
  - `class HubError extends Error { code: string }` (в `members.ts`, переиспользуется дальше)

- [ ] **Step 1: Падающие тесты** — `hub/test/members.test.ts`:
```ts
import { beforeEach, test, expect } from "vitest";
import { freshDb, testConfig as cfg } from "./helpers.js";
import { setInviteCode, register, authenticate, revoke, HubError } from "../src/members.js";
let pool: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => { pool = await freshDb(); await setInviteCode(pool, cfg, "team-code"); });

test("первый — админ, второй — нет; токен работает", async () => {
  const a = await register(pool, cfg, { inviteCode: "team-code", fullName: "Дмитрий Середа", shortName: "Дмитрий" });
  const b = await register(pool, cfg, { inviteCode: "team-code", fullName: "Дмитрий Волков", shortName: "Дима" });
  expect(a.member.isAdmin).toBe(true); expect(b.member.isAdmin).toBe(false);
  expect((await authenticate(pool, cfg, b.token))?.shortName).toBe("Дима");
});
test("неверный код приглашения", async () => {
  await expect(register(pool, cfg, { inviteCode: "x", fullName: "А", shortName: "а" })).rejects.toMatchObject({ code: "invalid_invite" });
});
test("занятое короткое имя (без учёта регистра)", async () => {
  await register(pool, cfg, { inviteCode: "team-code", fullName: "А", shortName: "Дима" });
  await expect(register(pool, cfg, { inviteCode: "team-code", fullName: "Б", shortName: "дима" })).rejects.toMatchObject({ code: "short_name_taken" });
});
test("токен хранится только хэшем", async () => {
  const { token } = await register(pool, cfg, { inviteCode: "team-code", fullName: "А", shortName: "а" });
  const r = await pool.query("select token_hash from members"); expect(r.rows[0].token_hash).not.toContain(token);
});
test("отзыв токена: только админ, после — authenticate = null", async () => {
  const a = await register(pool, cfg, { inviteCode: "team-code", fullName: "А", shortName: "а" });
  const b = await register(pool, cfg, { inviteCode: "team-code", fullName: "Б", shortName: "б" });
  await expect(revoke(pool, b.member.id, a.member.id)).rejects.toMatchObject({ code: "forbidden" });
  await revoke(pool, a.member.id, b.member.id);
  expect(await authenticate(pool, cfg, b.token)).toBeNull();
});
test("неизвестный токен", async () => { expect(await authenticate(pool, cfg, "tb_nope")).toBeNull(); });
```
Run → FAIL.

- [ ] **Step 2: Реализация** — `hub/src/members.ts`:
```ts
import type { Pool } from "./db.js";
import type { Config } from "./config.js";
import { hashSecret, newToken, safeEqual } from "./crypto.js";
import { withTx } from "./db.js";

export class HubError extends Error { constructor(public code: string, message?: string) { super(message ?? code); } }
export type Member = { id: number; fullName: string; shortName: string; isAdmin: boolean };
const toMember = (r: any): Member => ({ id: r.id, fullName: r.full_name, shortName: r.short_name, isAdmin: r.is_admin });

export async function setInviteCode(pool: Pool, cfg: Config, code: string) {
  await pool.query("insert into settings(key,value) values('invite_code_hash',$1) on conflict(key) do update set value=excluded.value",
    [hashSecret(cfg.salt, code)]);
}
export async function register(pool: Pool, cfg: Config, a: { inviteCode: string; fullName: string; shortName: string }) {
  const s = await pool.query("select value from settings where key='invite_code_hash'");
  if (!s.rows[0] || !safeEqual(s.rows[0].value, hashSecret(cfg.salt, a.inviteCode))) throw new HubError("invalid_invite", "Неверный код приглашения");
  const fullName = a.fullName.trim(), shortName = a.shortName.trim();
  if (!fullName || !shortName) throw new HubError("invalid_name", "Нужны полное и короткое имя");
  const token = newToken();
  return withTx(pool, async (c) => {
    const taken = await c.query("select 1 from members where lower(short_name)=lower($1)", [shortName]);
    if (taken.rowCount) throw new HubError("short_name_taken", `Имя «${shortName}» уже занято`);
    const first = (await c.query("select count(*)::int n from members")).rows[0].n === 0;
    const r = await c.query("insert into members(full_name,short_name,token_hash,is_admin) values($1,$2,$3,$4) returning *",
      [fullName, shortName, hashSecret(cfg.salt, token), first]);
    return { member: toMember(r.rows[0]), token };
  });
}
export async function authenticate(pool: Pool, cfg: Config, token: string): Promise<Member | null> {
  if (!token?.startsWith("tb_")) return null;
  const r = await pool.query("update members set last_seen_at=now() where token_hash=$1 and revoked_at is null returning *",
    [hashSecret(cfg.salt, token)]);
  return r.rows[0] ? toMember(r.rows[0]) : null;
}
export async function revoke(pool: Pool, adminId: number, memberId: number) {
  const a = await pool.query("select is_admin from members where id=$1 and revoked_at is null", [adminId]);
  if (!a.rows[0]?.is_admin) throw new HubError("forbidden", "Только админ");
  await pool.query("update members set revoked_at=now() where id=$1", [memberId]);
}
```
- [ ] **Step 3:** Run `npm test -w hub` → PASS.
- [ ] **Step 4: Commit** `git commit -am "Хаб: регистрация по коду приглашения, токены, админ, отзыв"` (с `git add -A`).

---

### Task 4: Справочник проектов и людей

**Files:**
- Create: `hub/src/projects.ts`
- Test: `hub/test/projects.test.ts`

**Interfaces:**
- Consumes: `Member`, `HubError`, `register`.
- Produces:
  - `type ProjectInput = { name: string; gitRemote?: string; localPath?: string }`
  - `setMyProjects(pool, memberId, { add?: ProjectInput[]; remove?: string[] }): Promise<MyProject[]>` (проект создаётся по имени, если его нет; имя сравнивается без учёта регистра)
  - `myProjects(pool, memberId): Promise<MyProject[]>` — `{ name, gitRemote, localPath }`
  - `directory(pool, query?): Promise<DirectoryEntry[]>` — `{ fullName, shortName, online: boolean, projects: string[] }`; `online` = есть в `onlineSet` (передаётся аргументом `online: Set<number>`)
  - `projectOwners(pool, projectName): Promise<{ projectId: number; ownerIds: number[] }>` — `HubError("unknown_project")`

Полная сигнатура `directory(pool, online: Set<number>, query?: string)`.

- [ ] **Step 1: Падающие тесты** — `hub/test/projects.test.ts`:
```ts
import { beforeEach, test, expect } from "vitest";
import { freshDb, testConfig as cfg } from "./helpers.js";
import { setInviteCode, register } from "../src/members.js";
import { setMyProjects, myProjects, directory, projectOwners } from "../src/projects.js";
let pool: any, me: any, dima: any;
beforeEach(async () => {
  pool = await freshDb(); await setInviteCode(pool, cfg, "c");
  me = (await register(pool, cfg, { inviteCode: "c", fullName: "Дмитрий Середа", shortName: "Дмитрий" })).member;
  dima = (await register(pool, cfg, { inviteCode: "c", fullName: "Дмитрий Волков", shortName: "Дима" })).member;
});
test("добавить и убрать проекты; имя без учёта регистра", async () => {
  await setMyProjects(pool, me.id, { add: [{ name: "fin", gitRemote: "git@git.evapps.ru:mvolkov/fin.git", localPath: "D:/fin" }] });
  await setMyProjects(pool, dima.id, { add: [{ name: "FIN", localPath: "/home/d/fin" }] });
  expect((await projectOwners(pool, "Fin")).ownerIds.sort()).toEqual([me.id, dima.id].sort());
  await setMyProjects(pool, me.id, { remove: ["fin"] });
  expect(await myProjects(pool, me.id)).toEqual([]);
});
test("directory: поиск по имени и проекту, онлайн", async () => {
  await setMyProjects(pool, dima.id, { add: [{ name: "fin" }] });
  const all = await directory(pool, new Set([dima.id]));
  expect(all.find((e) => e.shortName === "Дима")).toMatchObject({ online: true, projects: ["fin"] });
  expect((await directory(pool, new Set(), "волков")).map((e) => e.shortName)).toEqual(["Дима"]);
  expect((await directory(pool, new Set(), "fin")).map((e) => e.shortName)).toEqual(["Дима"]);
});
test("неизвестный проект", async () => {
  await expect(projectOwners(pool, "nope")).rejects.toMatchObject({ code: "unknown_project" });
});
test("отозванные не попадают в справочник и во владельцы", async () => {
  await setMyProjects(pool, dima.id, { add: [{ name: "fin" }] });
  await pool.query("update members set revoked_at=now() where id=$1", [dima.id]);
  expect((await projectOwners(pool, "fin")).ownerIds).toEqual([]);
  expect((await directory(pool, new Set())).map((e) => e.shortName)).toEqual(["Дмитрий"]);
});
```
- [ ] **Step 2: Реализация** — `hub/src/projects.ts`:
```ts
import type { Pool } from "./db.js";
import { HubError } from "./members.js";
export type ProjectInput = { name: string; gitRemote?: string; localPath?: string };
export type MyProject = { name: string; gitRemote: string | null; localPath: string | null };
export type DirectoryEntry = { fullName: string; shortName: string; online: boolean; projects: string[] };

async function ensureProject(pool: Pool, p: ProjectInput): Promise<number> {
  const name = p.name.trim();
  const found = await pool.query("select id from projects where lower(name)=lower($1)", [name]);
  if (found.rows[0]) {
    if (p.gitRemote) await pool.query("update projects set git_remote=coalesce(git_remote,$2) where id=$1", [found.rows[0].id, p.gitRemote]);
    return found.rows[0].id;
  }
  return (await pool.query("insert into projects(name,git_remote) values($1,$2) returning id", [name, p.gitRemote ?? null])).rows[0].id;
}
export async function setMyProjects(pool: Pool, memberId: number, a: { add?: ProjectInput[]; remove?: string[] }) {
  for (const p of a.add ?? []) {
    const pid = await ensureProject(pool, p);
    await pool.query(`insert into member_projects(member_id,project_id,local_path) values($1,$2,$3)
      on conflict(member_id,project_id) do update set local_path=coalesce(excluded.local_path, member_projects.local_path)`,
      [memberId, pid, p.localPath ?? null]);
  }
  for (const name of a.remove ?? [])
    await pool.query("delete from member_projects where member_id=$1 and project_id in (select id from projects where lower(name)=lower($2))", [memberId, name]);
  return myProjects(pool, memberId);
}
export async function myProjects(pool: Pool, memberId: number): Promise<MyProject[]> {
  const r = await pool.query(`select p.name, p.git_remote, mp.local_path from member_projects mp join projects p on p.id=mp.project_id
    where mp.member_id=$1 order by p.name`, [memberId]);
  return r.rows.map((x) => ({ name: x.name, gitRemote: x.git_remote, localPath: x.local_path }));
}
export async function directory(pool: Pool, online: Set<number>, query?: string): Promise<DirectoryEntry[]> {
  const r = await pool.query(`select m.id, m.full_name, m.short_name,
      coalesce(array_agg(p.name order by p.name) filter (where p.id is not null), '{}') projects
    from members m left join member_projects mp on mp.member_id=m.id left join projects p on p.id=mp.project_id
    where m.revoked_at is null group by m.id order by m.full_name`);
  const q = query?.trim().toLowerCase();
  return r.rows
    .map((x) => ({ id: x.id, fullName: x.full_name, shortName: x.short_name, online: online.has(x.id), projects: x.projects as string[] }))
    .filter((e) => !q || [e.fullName, e.shortName, ...e.projects].some((s) => s.toLowerCase().includes(q)))
    .map(({ id, ...e }) => e);
}
export async function projectOwners(pool: Pool, name: string) {
  const p = await pool.query("select id from projects where lower(name)=lower($1)", [name.trim()]);
  if (!p.rows[0]) throw new HubError("unknown_project", `Проект «${name}» не найден в справочнике`);
  const o = await pool.query(`select mp.member_id from member_projects mp join members m on m.id=mp.member_id
    where mp.project_id=$1 and m.revoked_at is null order by mp.member_id`, [p.rows[0].id]);
  return { projectId: p.rows[0].id as number, ownerIds: o.rows.map((x) => x.member_id as number) };
}
```
- [ ] **Step 3:** `npm test -w hub` → PASS.
- [ ] **Step 4: Commit** `"Хаб: справочник проектов и людей"`.

---

### Task 5: Ветки — ask, reply, decide, лимиты, маскирование, inbox, digest

**Files:**
- Create: `hub/src/threads.ts`
- Test: `hub/test/threads.test.ts`

**Interfaces:**
- Consumes: `projectOwners`, `HubError`, `maskSecrets`, `Config`, `withTx`.
- Produces (все функции возвращают простые объекты):
  - `type JobSink = (threadId: number, memberId: number) => Promise<void>` — вызывается, когда участнику нужно ответить (реализация — Task 6)
  - `ask(pool, cfg, sink, from: Member, a: { to?: string; project?: string; subject: string; text: string }, online: Set<number>): Promise<{ threadId: number; recipientShortName: string; status: string }>`
  - `reply(pool, cfg, sink, from: Member, a: { threadId: number; text: string; actions?: Action[] }): Promise<{ status: string; turns: number }>`
  - `decide(pool, from: Member, a: { threadId: number; summary: string; links?: string[] }): Promise<{ decisionId: number }>`
  - `getThread(pool, member: Member, threadId): Promise<ThreadView>` — `{ id, subject, project, status, turns, participants: string[], messages: { id, author, text, actions, createdAt }[], decision?: string }` (только участникам, иначе `forbidden`)
  - `inbox(pool, member): Promise<{ threads: { id, subject, status, newMessages: number }[]; decisions: { threadId, summary }[] }>` — помечает прочитанным
  - `listDecisions(pool, a: { project?: string; query?: string; limit?: number }): Promise<{ id, threadId, project, summary, links, createdAt }[]>`
  - `digest(pool, member, sinceIso?): Promise<{ decisions: {...}[]; needsHuman: {...}[]; open: {...}[] }>` — без пометки прочитанным
  - `type Action = { kind: "commit" | "mr" | "branch" | "link"; url: string; title?: string }`

Правила:
- Адресат `to` — короткое или полное имя (без учёта регистра). `to` и `project` вместе: адресат должен быть владельцем, иначе `HubError("not_owner")`. Только `project`: из владельцев (кроме себя) выбирается **онлайн** с наименьшим числом заданий `queued|running`, иначе первый по id. Нет владельцев кроме себя → `HubError("no_owners")`. Себе → `HubError("self_ask")`.
- Сообщение сохраняется после `maskSecrets`. `turns` растёт на 1 с каждым сообщением.
- После сообщения: если `turns >= cfg.maxTurns` → статус `needs_human`, задание не создаётся. Иначе статус `waiting`, `sink(threadId, другойУчастник)`.
- `reply` в закрытую ветку → `HubError("thread_closed")`; от не-участника → `forbidden`.
- `decide` — только участник; создаёт `decisions`, статус `closed`.

- [ ] **Step 1: Падающие тесты** — `hub/test/threads.test.ts`:
```ts
import { beforeEach, test, expect } from "vitest";
import { freshDb, testConfig as cfg } from "./helpers.js";
import { setInviteCode, register } from "../src/members.js";
import { setMyProjects } from "../src/projects.js";
import { ask, reply, decide, getThread, inbox, listDecisions, digest } from "../src/threads.js";
let pool: any, me: any, dima: any, ivan: any, jobs: [number, number][];
const sink = async (t: number, m: number) => { jobs.push([t, m]); };
beforeEach(async () => {
  pool = await freshDb(); await setInviteCode(pool, cfg, "c"); jobs = [];
  me = (await register(pool, cfg, { inviteCode: "c", fullName: "Дмитрий Середа", shortName: "Дмитрий" })).member;
  dima = (await register(pool, cfg, { inviteCode: "c", fullName: "Дмитрий Волков", shortName: "Дима" })).member;
  ivan = (await register(pool, cfg, { inviteCode: "c", fullName: "Иван Иванов", shortName: "Иван" })).member;
  await setMyProjects(pool, dima.id, { add: [{ name: "fin" }] });
  await setMyProjects(pool, ivan.id, { add: [{ name: "fin" }] });
});
test("по проекту выбирается владелец в сети", async () => {
  const r = await ask(pool, cfg, sink, me, { project: "fin", subject: "s", text: "q" }, new Set([ivan.id]));
  expect(r.recipientShortName).toBe("Иван"); expect(jobs).toEqual([[r.threadId, ivan.id]]);
});
test("никого в сети — первый владелец, статус waiting", async () => {
  const r = await ask(pool, cfg, sink, me, { project: "fin", subject: "s", text: "q" }, new Set());
  expect(r.recipientShortName).toBe("Дима"); expect(r.status).toBe("waiting");
});
test("по имени", async () => {
  const r = await ask(pool, cfg, sink, me, { to: "дима", subject: "s", text: "q" }, new Set());
  expect(r.recipientShortName).toBe("Дима");
});
test("ошибки адресации", async () => {
  await expect(ask(pool, cfg, sink, me, { to: "Дмитрий", subject: "s", text: "q" }, new Set())).rejects.toMatchObject({ code: "self_ask" });
  await expect(ask(pool, cfg, sink, me, { project: "nope", subject: "s", text: "q" }, new Set())).rejects.toMatchObject({ code: "unknown_project" });
  await setMyProjects(pool, me.id, { add: [{ name: "solo" }] });
  await expect(ask(pool, cfg, sink, me, { project: "solo", subject: "s", text: "q" }, new Set())).rejects.toMatchObject({ code: "no_owners" });
  await expect(ask(pool, cfg, sink, me, { to: "Дмитрий Середа", project: "fin", subject: "s", text: "q" }, new Set())).rejects.toMatchObject({ code: "self_ask" });
  await expect(ask(pool, cfg, sink, me, { subject: "s", text: "q" }, new Set())).rejects.toMatchObject({ code: "no_recipient" });
});
test("переписка по очереди и лимит реплик", async () => {
  const { threadId } = await ask(pool, cfg, sink, me, { to: "Дима", subject: "s", text: "1" }, new Set());
  let who = [dima, me];
  for (let i = 2; i <= 9; i++) await reply(pool, cfg, sink, who[i % 2], { threadId, text: String(i) });
  // 9 сообщений, задания чередуются
  expect(jobs.length).toBe(9);
  const last = await reply(pool, cfg, sink, dima, { threadId, text: "10" });
  expect(last).toEqual({ status: "needs_human", turns: 10 });
  expect(jobs.length).toBe(9);
});
test("маскирование и доступ к ветке", async () => {
  const { threadId } = await ask(pool, cfg, sink, me, { to: "Дима", subject: "s", text: "ключ glpat-AbCdEf1234567890xyz12" }, new Set());
  const t = await getThread(pool, dima, threadId);
  expect(t.messages[0].text).toContain("[скрыто]");
  await expect(getThread(pool, ivan, threadId)).rejects.toMatchObject({ code: "forbidden" });
});
test("decide закрывает ветку, решения ищутся, reply в закрытую — ошибка", async () => {
  const { threadId } = await ask(pool, cfg, sink, me, { project: "fin", subject: "сброс периода", text: "q" }, new Set([dima.id]));
  await decide(pool, dima, { threadId, summary: "Одна пустая дата — отказ, не сброс", links: ["https://git/mr/1"] });
  expect((await getThread(pool, me, threadId)).status).toBe("closed");
  expect((await listDecisions(pool, { project: "fin" }))[0].summary).toContain("отказ");
  expect((await listDecisions(pool, { query: "пустая" })).length).toBe(1);
  await expect(reply(pool, cfg, sink, me, { threadId, text: "x" })).rejects.toMatchObject({ code: "thread_closed" });
});
test("inbox помечает прочитанным, digest — нет", async () => {
  const { threadId } = await ask(pool, cfg, sink, me, { to: "Дима", subject: "s", text: "q" }, new Set());
  expect((await digest(pool, dima)).open.length).toBe(1);
  const i1 = await inbox(pool, dima); expect(i1.threads[0]).toMatchObject({ id: threadId, newMessages: 1 });
  const i2 = await inbox(pool, dima); expect(i2.threads.length).toBe(0);
  expect((await digest(pool, dima)).open.length).toBe(1);
});
```
- [ ] **Step 2: Реализация** — `hub/src/threads.ts`:
```ts
import type { Pool } from "./db.js";
import type { Config } from "./config.js";
import { HubError, type Member } from "./members.js";
import { projectOwners } from "./projects.js";
import { maskSecrets } from "./mask.js";

export type JobSink = (threadId: number, memberId: number) => Promise<void>;
export type Action = { kind: "commit" | "mr" | "branch" | "link"; url: string; title?: string };

async function findMember(pool: Pool, name: string) {
  const r = await pool.query("select id, short_name from members where revoked_at is null and (lower(short_name)=lower($1) or lower(full_name)=lower($1))", [name.trim()]);
  if (!r.rows[0]) throw new HubError("unknown_member", `Нет участника «${name}»`);
  return { id: r.rows[0].id as number, shortName: r.rows[0].short_name as string };
}
async function pickOwner(pool: Pool, ownerIds: number[], online: Set<number>) {
  const r = await pool.query(`select m.id, (select count(*) from jobs j where j.member_id=m.id and j.status in ('queued','running'))::int load
    from members m where m.id = any($1) order by m.id`, [ownerIds]);
  const rows = r.rows as { id: number; load: number }[];
  const on = rows.filter((x) => online.has(x.id)).sort((a, b) => a.load - b.load);
  return (on[0] ?? rows[0]).id;
}
async function addMessage(pool: Pool, cfg: Config, sink: JobSink, threadId: number, authorId: number, text: string, actions: Action[]) {
  await pool.query("insert into messages(thread_id,author_id,text,actions) values($1,$2,$3,$4)", [threadId, authorId, maskSecrets(text), JSON.stringify(actions)]);
  const t = (await pool.query("update threads set turns=turns+1, updated_at=now() where id=$1 returning turns", [threadId])).rows[0];
  const other = (await pool.query("select member_id from thread_participants where thread_id=$1 and member_id<>$2", [threadId, authorId])).rows[0]?.member_id;
  await pool.query("update thread_participants set last_read_message_id=(select max(id) from messages where thread_id=$1) where thread_id=$1 and member_id=$2", [threadId, authorId]);
  if (t.turns >= cfg.maxTurns) { await pool.query("update threads set status='needs_human' where id=$1", [threadId]); return { status: "needs_human", turns: t.turns }; }
  await pool.query("update threads set status='waiting' where id=$1", [threadId]);
  if (other) await sink(threadId, other);
  return { status: "waiting", turns: t.turns };
}
export async function ask(pool: Pool, cfg: Config, sink: JobSink, from: Member,
  a: { to?: string; project?: string; subject: string; text: string }, online: Set<number>) {
  if (!a.to && !a.project) throw new HubError("no_recipient", "Укажите адресата или проект");
  let projectId: number | null = null; let recipient: number;
  if (a.project) {
    const o = await projectOwners(pool, a.project); projectId = o.projectId;
    if (a.to) {
      const m = await findMember(pool, a.to); if (m.id === from.id) throw new HubError("self_ask", "Нельзя спросить самого себя");
      if (!o.ownerIds.includes(m.id)) throw new HubError("not_owner", `${m.shortName} не владелец проекта ${a.project}`);
      recipient = m.id;
    } else {
      const others = o.ownerIds.filter((id) => id !== from.id);
      if (!others.length) throw new HubError("no_owners", `У проекта «${a.project}» нет владельцев, кроме вас`);
      recipient = await pickOwner(pool, others, online);
    }
  } else {
    const m = await findMember(pool, a.to!); if (m.id === from.id) throw new HubError("self_ask", "Нельзя спросить самого себя");
    recipient = m.id;
  }
  const t = (await pool.query("insert into threads(subject,project_id,created_by) values($1,$2,$3) returning id", [a.subject.trim(), projectId, from.id])).rows[0];
  await pool.query("insert into thread_participants(thread_id,member_id) values($1,$2),($1,$3)", [t.id, from.id, recipient]);
  const res = await addMessage(pool, cfg, sink, t.id, from.id, a.text, []);
  const name = (await pool.query("select short_name from members where id=$1", [recipient])).rows[0].short_name;
  return { threadId: t.id as number, recipientShortName: name as string, status: res.status };
}
async function requireParticipant(pool: Pool, member: Member, threadId: number) {
  const t = (await pool.query(`select t.*, p.name project from threads t left join projects p on p.id=t.project_id where t.id=$1`, [threadId])).rows[0];
  if (!t) throw new HubError("unknown_thread", "Ветка не найдена");
  const p = await pool.query("select 1 from thread_participants where thread_id=$1 and member_id=$2", [threadId, member.id]);
  if (!p.rowCount) throw new HubError("forbidden", "Вы не участник ветки");
  return t;
}
export async function reply(pool: Pool, cfg: Config, sink: JobSink, from: Member, a: { threadId: number; text: string; actions?: Action[] }) {
  const t = await requireParticipant(pool, from, a.threadId);
  if (t.status === "closed") throw new HubError("thread_closed", "Ветка закрыта");
  if (t.status === "needs_human") throw new HubError("needs_human", "Ветка упёрлась в лимит, нужен человек");
  return addMessage(pool, cfg, sink, a.threadId, from.id, a.text, a.actions ?? []);
}
export async function decide(pool: Pool, from: Member, a: { threadId: number; summary: string; links?: string[] }) {
  const t = await requireParticipant(pool, from, a.threadId);
  const d = await pool.query("insert into decisions(thread_id,project_id,summary,links,created_by) values($1,$2,$3,$4,$5) returning id",
    [a.threadId, t.project_id, maskSecrets(a.summary), JSON.stringify(a.links ?? []), from.id]);
  await pool.query("update threads set status='closed', updated_at=now() where id=$1", [a.threadId]);
  return { decisionId: d.rows[0].id as number };
}
export async function getThread(pool: Pool, member: Member, threadId: number) {
  const t = await requireParticipant(pool, member, threadId);
  const parts = await pool.query("select m.short_name from thread_participants tp join members m on m.id=tp.member_id where tp.thread_id=$1 order by m.id", [threadId]);
  const msgs = await pool.query("select ms.*, m.short_name author from messages ms join members m on m.id=ms.author_id where thread_id=$1 order by ms.id", [threadId]);
  const dec = await pool.query("select summary from decisions where thread_id=$1 order by id desc limit 1", [threadId]);
  return { id: t.id, subject: t.subject, project: t.project, status: t.status, turns: t.turns,
    participants: parts.rows.map((x) => x.short_name),
    messages: msgs.rows.map((x) => ({ id: x.id, author: x.author, text: x.text, actions: x.actions, createdAt: x.created_at })),
    decision: dec.rows[0]?.summary };
}
async function unread(pool: Pool, memberId: number) {
  return (await pool.query(`select t.id, t.subject, t.status,
      (select count(*) from messages m where m.thread_id=t.id and m.id>tp.last_read_message_id and m.author_id<>$1)::int new_messages
    from threads t join thread_participants tp on tp.thread_id=t.id and tp.member_id=$1 order by t.updated_at desc`, [memberId])).rows;
}
export async function inbox(pool: Pool, member: Member) {
  const rows = (await unread(pool, member.id)).filter((r) => r.new_messages > 0);
  const decs = await pool.query(`select d.thread_id, d.summary from decisions d join thread_participants tp on tp.thread_id=d.thread_id and tp.member_id=$1
    where d.id > coalesce((select value::int from settings where key='inbox_dec_'||$1), 0) order by d.id`, [member.id]);
  await pool.query(`update thread_participants tp set last_read_message_id=coalesce((select max(id) from messages where thread_id=tp.thread_id),0) where member_id=$1`, [member.id]);
  await pool.query(`insert into settings(key,value) values('inbox_dec_'||$1, coalesce((select max(id) from decisions),0)::text)
    on conflict(key) do update set value=excluded.value`, [member.id]);
  return { threads: rows.map((r) => ({ id: r.id, subject: r.subject, status: r.status, newMessages: r.new_messages })),
    decisions: decs.rows.map((r) => ({ threadId: r.thread_id, summary: r.summary })) };
}
export async function listDecisions(pool: Pool, a: { project?: string; query?: string; limit?: number }) {
  const r = await pool.query(`select d.id, d.thread_id, p.name project, d.summary, d.links, d.created_at from decisions d left join projects p on p.id=d.project_id
    where ($1::text is null or lower(p.name)=lower($1)) and ($2::text is null or d.summary ilike '%'||$2||'%')
    order by d.id desc limit $3`, [a.project ?? null, a.query ?? null, a.limit ?? 50]);
  return r.rows.map((x) => ({ id: x.id, threadId: x.thread_id, project: x.project, summary: x.summary, links: x.links, createdAt: x.created_at }));
}
export async function digest(pool: Pool, member: Member, sinceIso?: string) {
  const since = sinceIso ?? new Date(Date.now() - 7 * 864e5).toISOString();
  const q = (status: string) => pool.query(`select t.id, t.subject, t.status, p.name project from threads t
    join thread_participants tp on tp.thread_id=t.id and tp.member_id=$1 left join projects p on p.id=t.project_id
    where t.status=$2 and t.updated_at >= $3 order by t.updated_at desc`, [member.id, status, since]);
  const decisions = await pool.query(`select d.thread_id, d.summary, p.name project, d.created_at from decisions d
    join thread_participants tp on tp.thread_id=d.thread_id and tp.member_id=$1 left join projects p on p.id=d.project_id
    where d.created_at >= $2 order by d.id desc`, [member.id, since]);
  return { decisions: decisions.rows, needsHuman: (await q("needs_human")).rows, open: (await q("waiting")).rows };
}
```
- [ ] **Step 3:** `npm test -w hub` → PASS.
- [ ] **Step 4: Commit** `"Хаб: ветки переписки, лимит реплик, решения, inbox и сводка"`.

---

### Task 6: Очередь заданий и шлюз ответчиков (WebSocket)

**Files:**
- Create: `hub/src/jobs.ts`, `hub/src/agentGateway.ts`
- Test: `hub/test/jobs.test.ts`, `hub/test/agentGateway.test.ts`

**Interfaces:**
- Consumes: `JobSink`, `authenticate`, `Member`, `Config`.
- Produces:
  - `enqueueJob(pool): JobSink` — создаёт `jobs` (`queued`), если для этой пары (thread, member) нет `queued|running`
  - `nextJobFor(pool, cfg, memberId): Promise<{ jobId, threadId } | null>` — берёт старейшее `queued`, если у участника нет `running` и запусков за последний час `< cfg.maxRunsPerHour`; ставит `running`, `started_at`, `attempts+1`
  - `finishJob(pool, jobId, ok: boolean, error?)`, `requeueRunning(pool, cfg, memberId)` (при разрыве: `attempts < maxAttempts` → `queued`, иначе `failed` + сообщение в ветку «агент X не смог ответить: …» от системы — от имени самого участника с префиксом `[система]`), `expireStale(pool, cfg)` (running дольше `jobTimeoutMs` → то же)
  - `class AgentGateway` — `constructor(pool, cfg)`, `online(): Set<number>`, `register(app: FastifyInstance)` (маршрут `GET /agent` WS), `notify(memberId)` (попытаться выдать задание)
  - Протокол WS (JSON): клиент → `{type:"hello", token}`; сервер → `{type:"ready", member:{id,shortName}}` или `{type:"error", code:"unauthorized"}` + закрытие 4401; сервер → `{type:"job", jobId, threadId, project: {name, localPath}|null}`; клиент → `{type:"started", jobId}`, `{type:"finished", jobId, ok, error?}`; сервер раз в 30 с — `{type:"ping"}`, клиент → `{type:"pong"}`.

- [ ] **Step 1: Падающие тесты**

`hub/test/jobs.test.ts`:
```ts
import { beforeEach, test, expect } from "vitest";
import { freshDb, testConfig } from "./helpers.js";
import { setInviteCode, register } from "../src/members.js";
import { ask } from "../src/threads.js";
import { enqueueJob, nextJobFor, finishJob, requeueRunning, expireStale } from "../src/jobs.js";
let pool: any, me: any, dima: any; const cfg = { ...testConfig, maxRunsPerHour: 2, maxAttempts: 2 };
beforeEach(async () => {
  pool = await freshDb(); await setInviteCode(pool, cfg, "c");
  me = (await register(pool, cfg, { inviteCode: "c", fullName: "А", shortName: "а" })).member;
  dima = (await register(pool, cfg, { inviteCode: "c", fullName: "Д", shortName: "д" })).member;
});
const q = (n = 1) => Promise.all(Array.from({ length: n }, (_, i) => ask(pool, cfg, enqueueJob(pool), me, { to: "д", subject: "s" + i, text: "q" }, new Set())));
test("по очереди: пока running — следующего нет", async () => {
  await q(2);
  const j1 = await nextJobFor(pool, cfg, dima.id); expect(j1).not.toBeNull();
  expect(await nextJobFor(pool, cfg, dima.id)).toBeNull();
  await finishJob(pool, j1!.jobId, true);
  expect(await nextJobFor(pool, cfg, dima.id)).not.toBeNull();
});
test("лимит запусков в час", async () => {
  await q(3);
  for (let i = 0; i < 2; i++) { const j = await nextJobFor(pool, cfg, dima.id); await finishJob(pool, j!.jobId, true); }
  expect(await nextJobFor(pool, cfg, dima.id)).toBeNull();
});
test("разрыв: повтор, затем failed с сообщением в ветке", async () => {
  const [{ threadId }] = await q(1);
  await nextJobFor(pool, cfg, dima.id); await requeueRunning(pool, cfg, dima.id);
  expect((await pool.query("select status, attempts from jobs")).rows[0]).toEqual({ status: "queued", attempts: 1 });
  await nextJobFor(pool, cfg, dima.id); await requeueRunning(pool, cfg, dima.id);
  expect((await pool.query("select status from jobs")).rows[0].status).toBe("failed");
  const m = await pool.query("select text from messages where thread_id=$1 order by id desc limit 1", [threadId]);
  expect(m.rows[0].text).toContain("не смог ответить");
});
test("зависшее задание истекает по таймауту", async () => {
  await q(1); await nextJobFor(pool, cfg, dima.id);
  await pool.query("update jobs set started_at=now()-interval '1 hour'");
  await expireStale(pool, cfg);
  expect((await pool.query("select status from jobs")).rows[0].status).toBe("queued");
});
test("дубль задания на ту же пару не создаётся", async () => {
  const [{ threadId }] = await q(1); await enqueueJob(pool)(threadId, dima.id);
  expect((await pool.query("select count(*)::int n from jobs")).rows[0].n).toBe(1);
});
```

`hub/test/agentGateway.test.ts`:
```ts
import { afterEach, beforeEach, test, expect } from "vitest";
import WebSocket from "ws";
import { freshDb, testConfig as cfg } from "./helpers.js";
import { buildServer } from "../src/server.js";
import { setInviteCode, register, revoke } from "../src/members.js";
import { ask } from "../src/threads.js";
let app: any, pool: any, url: string, me: any, dima: any;
beforeEach(async () => {
  pool = await freshDb(); await setInviteCode(pool, cfg, "c");
  me = await register(pool, cfg, { inviteCode: "c", fullName: "А", shortName: "а" });
  dima = await register(pool, cfg, { inviteCode: "c", fullName: "Д", shortName: "д" });
  app = await buildServer(pool, cfg); await app.listen({ port: 0, host: "127.0.0.1" });
  url = `ws://127.0.0.1:${app.server.address().port}/agent`;
});
afterEach(async () => { await app.close(); await pool.end(); });
function connect(token: string) {
  const ws = new WebSocket(url); const msgs: any[] = [];
  ws.on("message", (d) => msgs.push(JSON.parse(String(d))));
  return new Promise<{ ws: WebSocket; msgs: any[] }>((res) => ws.on("open", () => { ws.send(JSON.stringify({ type: "hello", token })); res({ ws, msgs }); }));
}
const until = async (f: () => boolean) => { for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 30)); };
test("ответчик получает задание, онлайн-статус, завершение", async () => {
  const { ws, msgs } = await connect(dima.token);
  await until(() => msgs.some((m) => m.type === "ready"));
  expect(app.gateway.online().has(dima.member.id)).toBe(true);
  const { threadId } = await app.services.ask(me.member, { to: "д", subject: "s", text: "q" });
  await until(() => msgs.some((m) => m.type === "job"));
  const job = msgs.find((m) => m.type === "job"); expect(job.threadId).toBe(threadId);
  ws.send(JSON.stringify({ type: "finished", jobId: job.jobId, ok: true }));
  await until(async () => false as any);
  ws.close(); await until(() => !app.gateway.online().has(dima.member.id));
  expect(app.gateway.online().has(dima.member.id)).toBe(false);
});
test("неверный токен — закрытие 4401", async () => {
  const ws = new WebSocket(url); const code = await new Promise<number>((res) => { ws.on("open", () => ws.send(JSON.stringify({ type: "hello", token: "tb_bad" }))); ws.on("close", (c) => res(c)); });
  expect(code).toBe(4401);
});
test("задание, созданное до подключения, выдаётся при подключении", async () => {
  await app.services.ask(me.member, { to: "д", subject: "s", text: "q" });
  const { msgs } = await connect(dima.token);
  await until(() => msgs.some((m) => m.type === "job"));
  expect(msgs.some((m) => m.type === "job")).toBe(true);
});
test("разрыв посреди задания возвращает его в очередь", async () => {
  await app.services.ask(me.member, { to: "д", subject: "s", text: "q" });
  const { ws, msgs } = await connect(dima.token); await until(() => msgs.some((m) => m.type === "job"));
  ws.terminate(); await until(() => !app.gateway.online().has(dima.member.id));
  await new Promise((r) => setTimeout(r, 100));
  expect((await pool.query("select status from jobs")).rows[0].status).toBe("queued");
});
```
(Второй тест `until(async…)` заменить на ожидание `status='done'`: `await until(() => false)` — плохо; в реализации теста использовать опрос БД: `for (...) { if ((await pool.query("select status from jobs")).rows[0].status==="done") break; await sleep(30); }` и `expect(...).toBe("done")`.)

- [ ] **Step 2: Реализация** — `hub/src/jobs.ts`:
```ts
import type { Pool } from "./db.js";
import type { Config } from "./config.js";
import type { JobSink } from "./threads.js";
export const enqueueJob = (pool: Pool): JobSink => async (threadId, memberId) => {
  await pool.query(`insert into jobs(thread_id,member_id) select $1,$2
    where not exists (select 1 from jobs where thread_id=$1 and member_id=$2 and status in ('queued','running'))`, [threadId, memberId]);
};
export async function nextJobFor(pool: Pool, cfg: Config, memberId: number) {
  const busy = await pool.query("select 1 from jobs where member_id=$1 and status='running'", [memberId]);
  if (busy.rowCount) return null;
  const runs = (await pool.query("select count(*)::int n from jobs where member_id=$1 and started_at > now()-interval '1 hour'", [memberId])).rows[0].n;
  if (runs >= cfg.maxRunsPerHour) return null;
  const r = await pool.query(`update jobs set status='running', started_at=now(), attempts=attempts+1
    where id=(select id from jobs where member_id=$1 and status='queued' order by id limit 1 for update skip locked)
    returning id, thread_id`, [memberId]);
  return r.rows[0] ? { jobId: r.rows[0].id as number, threadId: r.rows[0].thread_id as number } : null;
}
export async function finishJob(pool: Pool, jobId: number, ok: boolean, error?: string) {
  await pool.query("update jobs set status=$2, error=$3, finished_at=now() where id=$1 and status='running'", [jobId, ok ? "done" : "failed", error ?? null]);
  if (!ok) await failNote(pool, jobId, error ?? "неизвестная ошибка");
}
async function failNote(pool: Pool, jobId: number, error: string) {
  const j = (await pool.query("select j.thread_id, j.member_id, m.short_name from jobs j join members m on m.id=j.member_id where j.id=$1", [jobId])).rows[0];
  await pool.query("insert into messages(thread_id,author_id,text) values($1,$2,$3)", [j.thread_id, j.member_id, `[система] агент ${j.short_name} не смог ответить: ${error}`]);
}
async function retryOrFail(pool: Pool, cfg: Config, where: string, params: any[], reason: string) {
  const r = await pool.query(`select id, attempts from jobs where status='running' and ${where}`, params);
  for (const j of r.rows) {
    if (j.attempts < cfg.maxAttempts) await pool.query("update jobs set status='queued', started_at=null where id=$1", [j.id]);
    else { await pool.query("update jobs set status='failed', error=$2, finished_at=now() where id=$1", [j.id, reason]); await failNote(pool, j.id, reason); }
  }
}
export const requeueRunning = (pool: Pool, cfg: Config, memberId: number) => retryOrFail(pool, cfg, "member_id=$1", [memberId], "ответчик отключился");
export const expireStale = (pool: Pool, cfg: Config) => retryOrFail(pool, cfg, "started_at < now() - ($1::int * interval '1 millisecond')", [cfg.jobTimeoutMs], "превышено время ответа");
```
Примечание: в `nextJobFor` лимит считает задания с `started_at` за час, поэтому повторно запущенное после requeue (started_at обнулён) не считается дважды.

`hub/src/agentGateway.ts`:
```ts
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { Pool } from "./db.js";
import type { Config } from "./config.js";
import { authenticate, type Member } from "./members.js";
import { nextJobFor, finishJob, requeueRunning, expireStale } from "./jobs.js";
export class AgentGateway {
  private sockets = new Map<number, WebSocket>();
  private timer?: NodeJS.Timeout;
  constructor(private pool: Pool, private cfg: Config) {}
  online() { return new Set(this.sockets.keys()); }
  async notify(memberId: number) {
    const ws = this.sockets.get(memberId); if (!ws) return;
    const job = await nextJobFor(this.pool, this.cfg, memberId); if (!job) return;
    const p = (await this.pool.query(`select p.name, mp.local_path from threads t join projects p on p.id=t.project_id
      left join member_projects mp on mp.project_id=p.id and mp.member_id=$2 where t.id=$1`, [job.threadId, memberId])).rows[0];
    ws.send(JSON.stringify({ type: "job", jobId: job.jobId, threadId: job.threadId, project: p ? { name: p.name, localPath: p.local_path } : null }));
  }
  register(app: FastifyInstance) {
    app.get("/agent", { websocket: true }, (ws: WebSocket) => {
      let member: Member | null = null;
      ws.on("message", async (raw) => {
        let m: any; try { m = JSON.parse(String(raw)); } catch { return; }
        if (m.type === "hello") {
          member = await authenticate(this.pool, this.cfg, m.token);
          if (!member) { ws.send(JSON.stringify({ type: "error", code: "unauthorized" })); ws.close(4401, "unauthorized"); return; }
          this.sockets.get(member.id)?.close(4000, "replaced"); this.sockets.set(member.id, ws);
          ws.send(JSON.stringify({ type: "ready", member: { id: member.id, shortName: member.shortName } }));
          await requeueRunning(this.pool, this.cfg, member.id); await this.notify(member.id);
        } else if (member && m.type === "finished") {
          await finishJob(this.pool, m.jobId, !!m.ok, m.error); await this.notify(member.id);
        }
      });
      ws.on("close", async () => {
        if (member && this.sockets.get(member.id) === ws) { this.sockets.delete(member.id); await requeueRunning(this.pool, this.cfg, member.id); }
      });
    });
    this.timer = setInterval(async () => {
      await expireStale(this.pool, this.cfg);
      for (const [id, ws] of this.sockets) { ws.send(JSON.stringify({ type: "ping" })); await this.notify(id); }
    }, 30_000);
    app.addHook("onClose", async () => clearInterval(this.timer));
  }
}
```
(Проверка отзыва: при `ping` раз в 30 с делать `authenticate` по сохранённому токену; если null — закрыть 4401. Для этого хранить токен вместе с сокетом: `Map<number, { ws, token }>`; тест «отозванный токен» — в Task 7, после появления админского REST.)

- [ ] **Step 3: Минимальный `server.ts`** (полный — в Task 7) — чтобы тест шлюза работал:
```ts
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import type { Pool } from "./db.js";
import type { Config } from "./config.js";
import { AgentGateway } from "./agentGateway.js";
import { enqueueJob } from "./jobs.js";
import * as threads from "./threads.js";
import type { Member } from "./members.js";
export async function buildServer(pool: Pool, cfg: Config) {
  const app = Fastify({ logger: false }) as any;
  await app.register(websocket);
  const gateway = new AgentGateway(pool, cfg);
  const sink = async (threadId: number, memberId: number) => { await enqueueJob(pool)(threadId, memberId); await gateway.notify(memberId); };
  const services = {
    ask: (m: Member, a: any) => threads.ask(pool, cfg, sink, m, a, gateway.online()),
    reply: (m: Member, a: any) => threads.reply(pool, cfg, sink, m, a),
  };
  app.decorate("gateway", gateway); app.decorate("services", services);
  app.register(async (scope: any) => gateway.register(scope));
  return app;
}
```
- [ ] **Step 4:** `npm test -w hub` → PASS.
- [ ] **Step 5: Commit** `"Хаб: очередь заданий, лимит запусков, WebSocket-шлюз ответчиков"`.

---

### Task 7: MCP-инструменты, REST, админка, отзыв у подключённых

**Files:**
- Create: `hub/src/mcp.ts`, `hub/src/rest.ts`
- Modify: `hub/src/server.ts` (полная сборка), `hub/src/agentGateway.ts` (проверка отзыва на ping)
- Create: `hub/src/main.ts`
- Test: `hub/test/mcp.test.ts`, `hub/test/rest.test.ts`

**Interfaces:**
- Consumes: всё из Tasks 3–6.
- Produces:
  - `POST /mcp` — MCP Streamable HTTP без сессий (новые `McpServer` + `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })` на каждый запрос). Заголовки: `Authorization: Bearer <tb_…>` **или** `X-Invite-Code: <код>` (тогда доступен только `register`).
  - Инструменты (имена точно): `register`, `whoami`, `directory`, `my_projects`, `ask`, `reply`, `thread`, `inbox`, `decide`, `decisions`. Ответ инструмента — `content: [{ type: "text", text: JSON.stringify(result, null, 2) }]`; ошибка `HubError` → `isError: true`, текст — `message`.
  - `register` возвращает `{ token, member, next: "Сохраните токен: выполните в терминале `teambridge save-token <token>`" }`.
  - REST (Bearer): `GET /api/digest?since=`, `GET /api/threads`, `GET /api/threads/:id`, `GET /api/decisions?project=&q=`, `GET /api/members`, `GET /api/me`; админ: `POST /api/admin/invite {code}`, `POST /api/admin/revoke {memberId}`. 401 — без/с плохим токеном, 403 — не админ.
  - `main.ts`: `loadConfig` → `createPool` → `migrate` → если задан `TB_INVITE_CODE` и в settings нет кода — `setInviteCode` → `buildServer` → `listen({ port, host: "0.0.0.0" })`.

- [ ] **Step 1: Падающие тесты**

`hub/test/mcp.test.ts`:
```ts
import { afterEach, beforeEach, test, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { freshDb, testConfig as cfg } from "./helpers.js";
import { buildServer } from "../src/server.js";
import { setInviteCode } from "../src/members.js";
let app: any, pool: any, base: string;
beforeEach(async () => { pool = await freshDb(); await setInviteCode(pool, cfg, "c"); app = await buildServer(pool, cfg);
  await app.listen({ port: 0, host: "127.0.0.1" }); base = `http://127.0.0.1:${app.server.address().port}/mcp`; });
afterEach(async () => { await app.close(); await pool.end(); });
async function client(headers: Record<string, string>) {
  const c = new Client({ name: "t", version: "1" });
  await c.connect(new StreamableHTTPClientTransport(new URL(base), { requestInit: { headers } })); return c;
}
const call = async (c: Client, name: string, args: any = {}) => {
  const r: any = await c.callTool({ name, arguments: args }); return { err: !!r.isError, data: r.isError ? r.content[0].text : JSON.parse(r.content[0].text) };
};
test("регистрация по коду, потом работа по токену", async () => {
  const anon = await client({ "X-Invite-Code": "c" });
  expect((await anon.listTools()).tools.map((t) => t.name)).toEqual(["register"]);
  const reg = await call(anon, "register", { full_name: "Дмитрий Середа", short_name: "Дмитрий", projects: [{ name: "fin", local_path: "D:/fin" }] });
  expect(reg.data.token).toMatch(/^tb_/); expect(reg.data.next).toContain("teambridge save-token");
  const me = await client({ Authorization: `Bearer ${reg.data.token}` });
  expect((await me.listTools()).tools.map((t) => t.name).sort()).toEqual(["ask","decide","decisions","directory","inbox","my_projects","reply","thread","whoami"].sort());
  expect((await call(me, "whoami")).data).toMatchObject({ shortName: "Дмитрий", isAdmin: true, projects: [{ name: "fin" }] });
});
test("без заголовков — 401", async () => {
  const r = await fetch(base, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  expect(r.status).toBe(401);
});
test("переписка через MCP и ошибки как isError", async () => {
  const anon = await client({ "X-Invite-Code": "c" });
  const a = (await call(anon, "register", { full_name: "А", short_name: "а" })).data.token;
  const b = (await call(anon, "register", { full_name: "Б", short_name: "б", projects: [{ name: "fin" }] })).data.token;
  const ca = await client({ Authorization: `Bearer ${a}` }), cb = await client({ Authorization: `Bearer ${b}` });
  const t = (await call(ca, "ask", { project: "fin", subject: "тема", text: "вопрос" })).data;
  expect((await call(cb, "inbox")).data.threads[0].id).toBe(t.threadId);
  await call(cb, "reply", { thread_id: t.threadId, text: "ответ" });
  await call(cb, "decide", { thread_id: t.threadId, summary: "решили так" });
  expect((await call(ca, "decisions", { project: "fin" })).data[0].summary).toBe("решили так");
  const bad = await call(ca, "ask", { project: "nope", subject: "s", text: "q" });
  expect(bad.err).toBe(true); expect(bad.data).toContain("не найден");
});
```

`hub/test/rest.test.ts`:
```ts
import { afterEach, beforeEach, test, expect } from "vitest";
import WebSocket from "ws";
import { freshDb, testConfig } from "./helpers.js";
import { buildServer } from "../src/server.js";
import { setInviteCode, register } from "../src/members.js";
let app: any, pool: any, base: string, admin: any, user: any;
beforeEach(async () => {
  pool = await freshDb(); await setInviteCode(pool, testConfig, "c");
  admin = await register(pool, testConfig, { inviteCode: "c", fullName: "А", shortName: "а" });
  user = await register(pool, testConfig, { inviteCode: "c", fullName: "Б", shortName: "б" });
  app = await buildServer(pool, testConfig); await app.listen({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${app.server.address().port}`;
});
afterEach(async () => { await app.close(); await pool.end(); });
const get = (p: string, t?: string) => fetch(base + p, { headers: t ? { authorization: `Bearer ${t}` } : {} });
const post = (p: string, t: string, body: any) => fetch(base + p, { method: "POST", headers: { authorization: `Bearer ${t}`, "content-type": "application/json" }, body: JSON.stringify(body) });
test("401 без токена, me с токеном", async () => {
  expect((await get("/api/me")).status).toBe(401);
  expect(await (await get("/api/me", user.token)).json()).toMatchObject({ shortName: "б" });
});
test("админские ручки", async () => {
  expect((await post("/api/admin/invite", user.token, { code: "x" })).status).toBe(403);
  expect((await post("/api/admin/invite", admin.token, { code: "new" })).status).toBe(200);
  await expect(register(pool, testConfig, { inviteCode: "c", fullName: "В", shortName: "в" })).rejects.toMatchObject({ code: "invalid_invite" });
  expect((await get("/api/me", user.token)).status).toBe(200); // старые токены живы
  expect((await post("/api/admin/revoke", admin.token, { memberId: user.member.id })).status).toBe(200);
  expect((await get("/api/me", user.token)).status).toBe(401);
});
test("отозванный ответчик отключается на ping", async () => {
  const ws = new WebSocket(base.replace("http", "ws") + "/agent");
  await new Promise((r) => ws.on("open", r)); ws.send(JSON.stringify({ type: "hello", token: user.token }));
  await new Promise((r) => setTimeout(r, 200));
  await post("/api/admin/revoke", admin.token, { memberId: user.member.id });
  const code = await new Promise<number>((res) => { ws.on("close", (c) => res(c)); app.gateway.tick(); });
  expect(code).toBe(4401);
});
test("веб-страница отдаётся", async () => {
  const r = await get("/"); expect(r.status).toBe(200); expect(await r.text()).toContain("TeamBridge");
});
```
`AgentGateway.tick()` — публичный метод с телом интервала (expireStale + проверка токенов + ping + notify), чтобы тест не ждал 30 с.

- [ ] **Step 2: `hub/src/mcp.ts`**
```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Pool } from "./db.js";
import type { Config } from "./config.js";
import { HubError, register, type Member } from "./members.js";
import { setMyProjects, myProjects, directory } from "./projects.js";
import * as threads from "./threads.js";
import type { AgentGateway } from "./agentGateway.js";
const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const wrap = (fn: (a: any) => Promise<unknown>) => async (a: any) => {
  try { return ok(await fn(a)); }
  catch (e) { if (e instanceof HubError) return { isError: true, content: [{ type: "text" as const, text: e.message }] }; throw e; }
};
const project = z.object({ name: z.string(), git_remote: z.string().optional(), local_path: z.string().optional() });
const toInput = (p: any) => ({ name: p.name, gitRemote: p.git_remote, localPath: p.local_path });
export function buildMcp(pool: Pool, cfg: Config, gateway: AgentGateway, sink: threads.JobSink, auth: { member?: Member; inviteCode?: string }) {
  const s = new McpServer({ name: "teambridge", version: "0.1.0" });
  if (!auth.member) {
    s.registerTool("register", {
      description: "Зарегистрироваться в TeamBridge. Спросите у человека полное имя и короткое имя для обращения, предложите проекты по git remote текущих папок.",
      inputSchema: { full_name: z.string(), short_name: z.string(), projects: z.array(project).optional() },
    }, wrap(async (a) => {
      const r = await register(pool, cfg, { inviteCode: auth.inviteCode!, fullName: a.full_name, shortName: a.short_name });
      if (a.projects?.length) await setMyProjects(pool, r.member.id, { add: a.projects.map(toInput) });
      return { token: r.token, member: r.member, next: `Сохраните токен: выполните в терминале \`teambridge save-token ${r.token}\`` };
    }));
    return s;
  }
  const me = auth.member;
  s.registerTool("whoami", { description: "Мой профиль и проекты в TeamBridge", inputSchema: {} },
    wrap(async () => ({ ...me, projects: await myProjects(pool, me.id) })));
  s.registerTool("directory", { description: "Справочник: люди, их проекты, кто в сети. query — поиск по имени или проекту.", inputSchema: { query: z.string().optional() } },
    wrap(async (a) => directory(pool, gateway.online(), a.query)));
  s.registerTool("my_projects", { description: "Добавить/убрать мои проекты (name, git_remote, local_path — путь к репозиторию на моей машине)",
    inputSchema: { add: z.array(project).optional(), remove: z.array(z.string()).optional() } },
    wrap(async (a) => setMyProjects(pool, me.id, { add: a.add?.map(toInput), remove: a.remove })));
  s.registerTool("ask", { description: "Задать вопрос агенту коллеги: to — имя, project — проект (хаб выберет владельца). Сначала проверьте decisions по проекту.",
    inputSchema: { to: z.string().optional(), project: z.string().optional(), subject: z.string(), text: z.string() } },
    wrap(async (a) => threads.ask(pool, cfg, sink, me, a, gateway.online())));
  s.registerTool("reply", { description: "Ответить в ветке. actions — ссылки на коммиты/MR/ветки.",
    inputSchema: { thread_id: z.number(), text: z.string(), actions: z.array(z.object({ kind: z.enum(["commit","mr","branch","link"]), url: z.string(), title: z.string().optional() })).optional() } },
    wrap(async (a) => threads.reply(pool, cfg, sink, me, { threadId: a.thread_id, text: a.text, actions: a.actions })));
  s.registerTool("thread", { description: "Прочитать ветку целиком", inputSchema: { thread_id: z.number() } },
    wrap(async (a) => threads.getThread(pool, me, a.thread_id)));
  s.registerTool("inbox", { description: "Новое для меня: ветки с непрочитанными сообщениями и новые итоги", inputSchema: {} },
    wrap(async () => threads.inbox(pool, me)));
  s.registerTool("decide", { description: "Записать итог ветки в журнал (о чём договорились, что сделано, что осталось) и закрыть ветку",
    inputSchema: { thread_id: z.number(), summary: z.string(), links: z.array(z.string()).optional() } },
    wrap(async (a) => threads.decide(pool, me, { threadId: a.thread_id, summary: a.summary, links: a.links })));
  s.registerTool("decisions", { description: "Журнал решений: по проекту и/или поиск по тексту", inputSchema: { project: z.string().optional(), query: z.string().optional() } },
    wrap(async (a) => threads.listDecisions(pool, a)));
  return s;
}
```

- [ ] **Step 3: `hub/src/rest.ts`**
```ts
import type { FastifyInstance } from "fastify";
import type { Pool } from "./db.js";
import type { Config } from "./config.js";
import { authenticate, revoke, setInviteCode, HubError, type Member } from "./members.js";
import { directory } from "./projects.js";
import * as threads from "./threads.js";
import type { AgentGateway } from "./agentGateway.js";
export function bearer(h?: string) { return h?.startsWith("Bearer ") ? h.slice(7) : undefined; }
export function registerRest(app: FastifyInstance, pool: Pool, cfg: Config, gateway: AgentGateway) {
  app.addHook("preHandler", async (req: any, reply) => {
    if (!req.url.startsWith("/api/")) return;
    const m = await authenticate(pool, cfg, bearer(req.headers.authorization) ?? "");
    if (!m) return reply.code(401).send({ error: "unauthorized" });
    req.member = m;
  });
  const me = (req: any) => req.member as Member;
  const handle = (fn: (req: any) => Promise<unknown>) => async (req: any, reply: any) => {
    try { return await fn(req); }
    catch (e) { if (e instanceof HubError) return reply.code(e.code === "forbidden" ? 403 : 400).send({ error: e.code, message: e.message }); throw e; }
  };
  app.get("/api/me", handle(async (r) => me(r)));
  app.get("/api/digest", handle(async (r) => threads.digest(pool, me(r), r.query.since)));
  app.get("/api/members", handle(async () => directory(pool, gateway.online())));
  app.get("/api/decisions", handle(async (r) => threads.listDecisions(pool, { project: r.query.project, query: r.query.q })));
  app.get("/api/threads", handle(async (r) => (await pool.query(`select t.id, t.subject, t.status, t.turns, t.updated_at, p.name project
      from threads t join thread_participants tp on tp.thread_id=t.id and tp.member_id=$1 left join projects p on p.id=t.project_id
      order by t.updated_at desc limit 200`, [me(r).id])).rows));
  app.get("/api/threads/:id", handle(async (r) => threads.getThread(pool, me(r), Number(r.params.id))));
  app.post("/api/admin/invite", handle(async (r) => { if (!me(r).isAdmin) throw new HubError("forbidden", "Только админ"); await setInviteCode(pool, cfg, r.body.code); return { ok: true }; }));
  app.post("/api/admin/revoke", handle(async (r) => { await revoke(pool, me(r).id, Number(r.body.memberId)); return { ok: true }; }));
}
```
Веб-лента для админа видит только свои ветки — ок для v1 (решения видны всем через `/api/decisions`).

- [ ] **Step 4: Полный `hub/src/server.ts`**
```ts
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Pool } from "./db.js";
import type { Config } from "./config.js";
import { AgentGateway } from "./agentGateway.js";
import { enqueueJob } from "./jobs.js";
import { authenticate, type Member } from "./members.js";
import * as threads from "./threads.js";
import { buildMcp } from "./mcp.js";
import { registerRest, bearer } from "./rest.js";
export async function buildServer(pool: Pool, cfg: Config) {
  const app = Fastify({ logger: process.env.NODE_ENV === "production" }) as any;
  await app.register(websocket);
  await app.register(fastifyStatic, { root: fileURLToPath(new URL("../public", import.meta.url)) });
  const gateway = new AgentGateway(pool, cfg);
  const sink: threads.JobSink = async (t, m) => { await enqueueJob(pool)(t, m); await gateway.notify(m); };
  app.decorate("gateway", gateway);
  app.decorate("services", { ask: (m: Member, a: any) => threads.ask(pool, cfg, sink, m, a, gateway.online()) });
  app.register(async (scope: any) => gateway.register(scope));
  registerRest(app, pool, cfg, gateway);
  app.post("/mcp", async (req: any, reply: any) => {
    const token = bearer(req.headers.authorization);
    const member = token ? await authenticate(pool, cfg, token) : null;
    const inviteCode = req.headers["x-invite-code"] as string | undefined;
    if (!member && !inviteCode) return reply.code(401).send({ error: "unauthorized" });
    const server = buildMcp(pool, cfg, gateway, sink, { member: member ?? undefined, inviteCode });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    req.raw.on("close", () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });
  for (const m of ["get", "delete"]) app[m]("/mcp", async (_r: any, reply: any) => reply.code(405).send({ error: "method_not_allowed" }));
  return app;
}
```

- [ ] **Step 5: `agentGateway.ts` — `tick()` и отзыв**: хранить `Map<number, { ws, token }>`; `hello` сохраняет токен; `tick()` = `expireStale` → для каждого `{ws, token}`: `authenticate` → null ? `ws.close(4401)` и удалить : `ping` + `notify`. Интервал 30 с вызывает `tick()`.

- [ ] **Step 6: `hub/src/main.ts`**
```ts
import { loadConfig } from "./config.js";
import { createPool, migrate } from "./db.js";
import { setInviteCode } from "./members.js";
import { buildServer } from "./server.js";
const cfg = loadConfig(); const pool = createPool(cfg.databaseUrl); await migrate(pool);
if (process.env.TB_INVITE_CODE) {
  const has = await pool.query("select 1 from settings where key='invite_code_hash'");
  if (!has.rowCount) await setInviteCode(pool, cfg, process.env.TB_INVITE_CODE);
}
const app = await buildServer(pool, cfg); await app.listen({ port: cfg.port, host: "0.0.0.0" });
```
- [ ] **Step 7:** заглушка `hub/public/index.html` с `<title>TeamBridge</title>` (полная — Task 8). `npm test -w hub` → PASS.
- [ ] **Step 8: Commit** `"Хаб: MCP-инструменты, REST, админка, отзыв подключённых ответчиков"`.

---

### Task 8: Веб-страница

**Files:**
- Create/Modify: `hub/public/index.html`, `hub/public/app.js`, `hub/public/style.css`
- Test: проверка руками (Step 3) + существующий тест «веб-страница отдаётся».

**Interfaces:**
- Consumes: REST `/api/me`, `/api/threads`, `/api/threads/:id`, `/api/decisions`, `/api/members`, `/api/admin/*`.
- Produces: страница: вход по токену (хранится в `localStorage['tb_token']`), вкладки «Ветки», «Решения», «Люди», для админа — «Админ» (смена кода, отзыв).

- [ ] **Step 1: `index.html`**
```html
<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TeamBridge</title><link rel="stylesheet" href="/style.css"></head><body>
<header><h1>TeamBridge</h1><nav id="tabs" hidden>
  <button data-tab="threads">Ветки</button><button data-tab="decisions">Решения</button><button data-tab="people">Люди</button>
  <button data-tab="admin" id="adminTab" hidden>Админ</button><button id="logout">Выйти</button></nav></header>
<main>
  <form id="login"><p>Вставьте свой токен TeamBridge (его выдал ваш Claude при регистрации, он есть в <code>~/.teambridge/config.json</code>).</p>
    <input id="token" placeholder="tb_…" autocomplete="off"><button>Войти</button><p id="loginError" class="err"></p></form>
  <section id="view"></section>
</main><script src="/app.js"></script></body></html>
```
- [ ] **Step 2: `app.js`** (без сборки, только `fetch` и `textContent` — без `innerHTML` для данных):
```js
const $ = (s) => document.querySelector(s); let me = null;
const api = async (path, opts = {}) => {
  const r = await fetch(path, { ...opts, headers: { authorization: "Bearer " + localStorage.tb_token, "content-type": "application/json", ...(opts.headers || {}) } });
  if (r.status === 401) { logout(); throw new Error("unauthorized"); } return r.json();
};
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.flat().filter(Boolean)); return e; };
const STATUS = { open: "открыта", waiting: "ждёт ответа", closed: "закрыта", needs_human: "нужен человек" };
function logout() { delete localStorage.tb_token; location.reload(); }
async function start() {
  if (!localStorage.tb_token) return;
  try { me = await api("/api/me"); } catch { return; }
  $("#login").hidden = true; $("#tabs").hidden = false; $("#adminTab").hidden = !me.isAdmin; show("threads");
}
async function show(tab) {
  const v = $("#view"); v.replaceChildren(el("p", { textContent: "Загрузка…" }));
  if (tab === "threads") {
    const rows = await api("/api/threads");
    v.replaceChildren(el("h2", { textContent: "Мои ветки" }), ...rows.map((t) => el("div", { className: "row", onclick: () => openThread(t.id) },
      el("b", { textContent: `#${t.id} ${t.subject}` }), el("span", { className: "st " + t.status, textContent: STATUS[t.status] }),
      el("small", { textContent: `${t.project ?? "без проекта"} · ${t.turns} реплик` }))));
  } else if (tab === "decisions") {
    const rows = await api("/api/decisions");
    v.replaceChildren(el("h2", { textContent: "Журнал решений" }), ...rows.map((d) => el("div", { className: "row" },
      el("b", { textContent: d.project ?? "общее" }), el("p", { textContent: d.summary }), el("small", { textContent: new Date(d.createdAt).toLocaleString("ru") }))));
  } else if (tab === "people") {
    const rows = await api("/api/members");
    v.replaceChildren(el("h2", { textContent: "Люди" }), ...rows.map((p) => el("div", { className: "row" },
      el("b", { textContent: `${p.fullName} (${p.shortName})` }), el("span", { className: "st " + (p.online ? "closed" : ""), textContent: p.online ? "в сети" : "не в сети" }),
      el("small", { textContent: p.projects.join(", ") || "без проектов" }))));
  } else if (tab === "admin") {
    const code = el("input", { placeholder: "новый код приглашения" });
    v.replaceChildren(el("h2", { textContent: "Админ" }), el("p", { textContent: "Смена кода приглашения (выданные токены продолжат работать)" }), code,
      el("button", { textContent: "Сменить", onclick: async () => { await api("/api/admin/invite", { method: "POST", body: JSON.stringify({ code: code.value }) }); code.value = ""; alert("Код сменён"); } }));
  }
}
async function openThread(id) {
  const t = await api("/api/threads/" + id);
  $("#view").replaceChildren(el("h2", { textContent: `#${t.id} ${t.subject}` }),
    el("p", { textContent: `${t.project ?? "без проекта"} · ${STATUS[t.status]} · ${t.participants.join(" ↔ ")}` }),
    ...t.messages.map((m) => el("div", { className: "msg" }, el("b", { textContent: m.author }), el("pre", { textContent: m.text }),
      ...(m.actions || []).map((a) => el("a", { href: a.url, target: "_blank", textContent: `${a.kind}: ${a.title ?? a.url}` })))),
    t.decision ? el("div", { className: "decision" }, el("b", { textContent: "Итог" }), el("pre", { textContent: t.decision })) : null);
}
$("#login").onsubmit = (e) => { e.preventDefault(); localStorage.tb_token = $("#token").value.trim(); start().then(() => { if (!me) $("#loginError").textContent = "Токен не подошёл"; }); };
$("#logout").onclick = logout;
document.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => show(b.dataset.tab)));
start();
```
`style.css` — простая вёрстка: системный шрифт, `.row` карточки, `.st.waiting` оранжевый, `.st.needs_human` красный, `.st.closed` зелёный, `pre { white-space: pre-wrap }`, ширина до 900px, мобильная до 375px без горизонтального скролла.

- [ ] **Step 3: Проверка руками**: `npm run dev -w hub` с тестовой БД, зарегистрировать двоих через MCP-тест или REST, открыть `http://localhost:8120`, войти токеном — видны вкладки, ветка открывается, ширина 375px без горизонтальной прокрутки.
- [ ] **Step 4: Commit** `"Хаб: веб-страница — ветки, решения, люди, админ"`.

---

### Task 9: Docker-образ, compose для сервера, бэкап, деплой на 10.10.140.2

**Files:**
- Create: `hub/Dockerfile`, `deploy/docker-compose.yml`, `deploy/backup.sh`, `deploy/deploy.sh`, `deploy/.env.example`

**Interfaces:**
- Produces: хаб на `http://10.10.140.2:8120`, `GET /` = 200.

- [ ] **Step 1: `hub/Dockerfile`**
```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY hub/package.json hub/
RUN npm ci -w hub --include-workspace-root=false
COPY tsconfig.base.json ./
COPY hub hub
RUN npm run build -w hub
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/hub/dist hub/dist
COPY --from=build /app/hub/public hub/public
COPY hub/package.json hub/
WORKDIR /app/hub
CMD ["node", "dist/main.js"]
```
- [ ] **Step 2: `deploy/docker-compose.yml`**
```yaml
name: teambridge
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment: { POSTGRES_USER: tb, POSTGRES_PASSWORD: "${TB_DB_PASSWORD}", POSTGRES_DB: tb }
    volumes: [pgdata:/var/lib/postgresql/data]
  hub:
    build: { context: .., dockerfile: hub/Dockerfile }
    restart: unless-stopped
    depends_on: [postgres]
    environment:
      TB_DATABASE_URL: "postgres://tb:${TB_DB_PASSWORD}@postgres:5432/tb"
      TB_SALT: "${TB_SALT}"
      TB_INVITE_CODE: "${TB_INVITE_CODE}"
      TB_PORT: "8120"
    ports: ["8120:8120"]
volumes: { pgdata: {} }
```
`deploy/.env.example`: `TB_DB_PASSWORD=`, `TB_SALT=`, `TB_INVITE_CODE=` (значения генерируются при деплое `openssl rand -hex 24`, хранятся только в `~/teambridge/deploy/.env` на сервере).

- [ ] **Step 3: `deploy/backup.sh`**
```sh
#!/bin/sh
set -e
cd "$(dirname "$0")"
mkdir -p ../backups
docker compose exec -T postgres pg_dump -U tb tb | gzip > ../backups/tb-$(date +%F).sql.gz
ls -1t ../backups/tb-*.sql.gz | tail -n +15 | xargs -r rm --
```
Cron (пользователь `admins`): `15 3 * * * ~/teambridge/deploy/backup.sh >> ~/teambridge/backups/backup.log 2>&1`.

- [ ] **Step 4: `deploy/deploy.sh`** (запускается локально)
```sh
#!/bin/sh
set -e
HOST=admins@10.10.140.2
SSH="ssh -i $HOME/.ssh/amo_tg_server -o IdentitiesOnly=yes $HOST"
cd "$(dirname "$0")/.."
git archive --format=tar HEAD | $SSH "mkdir -p ~/teambridge && tar xf - -C ~/teambridge"
$SSH 'cd ~/teambridge/deploy && [ -f .env ] || { printf "TB_DB_PASSWORD=%s\nTB_SALT=%s\nTB_INVITE_CODE=%s\n" $(openssl rand -hex 24) $(openssl rand -hex 24) $(openssl rand -hex 8) > .env; chmod 600 .env; }'
$SSH 'cd ~/teambridge/deploy && docker compose up -d --build && chmod +x backup.sh'
$SSH '(crontab -l 2>/dev/null | grep -v teambridge/deploy/backup.sh; echo "15 3 * * * ~/teambridge/deploy/backup.sh >> ~/teambridge/backups/backup.log 2>&1") | crontab -'
```
- [ ] **Step 5: Деплой и проверка** (отдельными вызовами SSH):
Run: `sh deploy/deploy.sh`, затем `ssh … "docker compose -f ~/teambridge/deploy/docker-compose.yml ps; curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8120/"`
Expected: оба контейнера `running`, `200`. С локальной машины: `curl -s -o /dev/null -w "%{http_code}" http://10.10.140.2:8120/` → `200`. Код приглашения прочитать один раз: `ssh … "grep TB_INVITE_CODE ~/teambridge/deploy/.env"` — сообщить пользователю в чате не целиком в лог, а для README-инструкции.
- [ ] **Step 6: Commit** `"Деплой хаба: Docker, compose, ежедневный бэкап"`.

---

### Task 10: CLI — конфиг, setup (MCP, хук, автозапуск), save-token, digest, status

**Files:**
- Create: `cli/src/config.ts`, `cli/src/hubClient.ts`, `cli/src/setup.ts`, `cli/src/autostart.ts`, `cli/src/index.ts`
- Test: `cli/test/config.test.ts`, `cli/test/setup.test.ts`, `cli/test/autostart.test.ts`

**Interfaces:**
- Produces:
  - `type CliConfig = { hub: string; token?: string; inviteCode?: string }`; `configDir(home?)` = `~/.teambridge`; `readConfig(dir?)`, `writeConfig(cfg, dir?)` (права 600 на POSIX)
  - `hubClient(cfg).get<T>(path)` — fetch с Bearer, ошибка с текстом при не-2xx
  - `setupCommands(cfg, platform, exe): string[][]` — список команд (для теста): `["claude","mcp","remove","teambridge","-s","user"]`, `["claude","mcp","add","--transport","http","-s","user","teambridge",`${hub}/mcp`,"-H", header]` где header = `Authorization: Bearer <token>` или `X-Invite-Code: <code>`
  - `hookSettingsPatch(exe)` → объект для `~/.claude/settings.json`: `{ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "<exe> digest" }] }] } }` (слияние без дублей)
  - `autostartSpec(platform, exe, home)` → `{ kind: "schtasks" | "launchd" | "systemd", files: {path, content}[], commands: string[][] }`
  - команды: `teambridge setup --hub <url> --invite <code>`, `teambridge save-token <token>`, `teambridge digest`, `teambridge status`, `teambridge agent`

- [ ] **Step 1: Падающие тесты** (`cli/test/setup.test.ts`):
```ts
import { test, expect } from "vitest";
import { setupCommands, hookSettingsPatch, mergeSettings } from "../src/setup.js";
import { autostartSpec } from "../src/autostart.js";
test("MCP: до регистрации — код приглашения, после — токен", () => {
  expect(setupCommands({ hub: "http://h:8120", inviteCode: "c" }).at(-1)).toEqual(["claude","mcp","add","--transport","http","-s","user","teambridge","http://h:8120/mcp","-H","X-Invite-Code: c"]);
  expect(setupCommands({ hub: "http://h:8120", token: "tb_x" }).at(-1)).toContain("Authorization: Bearer tb_x");
});
test("хук SessionStart добавляется один раз", () => {
  const once = mergeSettings({}, hookSettingsPatch("teambridge"));
  const twice = mergeSettings(once, hookSettingsPatch("teambridge"));
  expect(twice.hooks.SessionStart).toHaveLength(1);
  expect(mergeSettings({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "other" }] }] } }, hookSettingsPatch("teambridge")).hooks.SessionStart).toHaveLength(2);
});
test("автозапуск по платформам", () => {
  expect(autostartSpec("win32", "C:/x/teambridge.cmd", "C:/Users/u").commands[0]).toEqual(
    ["schtasks","/Create","/F","/SC","ONLOGON","/TN","TeamBridgeAgent","/TR","\"C:/x/teambridge.cmd\" agent"]);
  const mac = autostartSpec("darwin", "/usr/local/bin/teambridge", "/Users/u");
  expect(mac.files[0].path).toBe("/Users/u/Library/LaunchAgents/ru.evapps.teambridge.plist");
  expect(mac.files[0].content).toContain("<string>agent</string>");
  const lin = autostartSpec("linux", "/usr/bin/teambridge", "/home/u");
  expect(lin.files[0].path).toBe("/home/u/.config/systemd/user/teambridge.service");
  expect(lin.commands).toContainEqual(["systemctl","--user","enable","--now","teambridge.service"]);
});
```
`cli/test/config.test.ts`: запись/чтение во временную папку (`mkdtempSync`), отсутствующий файл → `null`.
- [ ] **Step 2: Реализация** `cli/src/config.ts`:
```ts
import { mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { homedir } from "node:os"; import { join } from "node:path";
export type CliConfig = { hub: string; token?: string; inviteCode?: string };
export const configDir = (home = homedir()) => join(home, ".teambridge");
export function readConfig(dir = configDir()): CliConfig | null {
  const f = join(dir, "config.json"); return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
}
export function writeConfig(cfg: CliConfig, dir = configDir()) {
  mkdirSync(dir, { recursive: true }); const f = join(dir, "config.json");
  writeFileSync(f, JSON.stringify(cfg, null, 2)); if (process.platform !== "win32") chmodSync(f, 0o600);
}
```
`cli/src/setup.ts`:
```ts
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os"; import { join } from "node:path";
import type { CliConfig } from "./config.js";
export function setupCommands(cfg: CliConfig): string[][] {
  const header = cfg.token ? `Authorization: Bearer ${cfg.token}` : `X-Invite-Code: ${cfg.inviteCode}`;
  return [["claude","mcp","remove","teambridge","-s","user"],
          ["claude","mcp","add","--transport","http","-s","user","teambridge",`${cfg.hub}/mcp`,"-H",header]];
}
export const hookSettingsPatch = (exe: string) => ({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: `${exe} digest` }] }] } });
export function mergeSettings(cur: any, patch: any) {
  const out = { ...cur, hooks: { ...(cur.hooks ?? {}) } };
  const list = [...(out.hooks.SessionStart ?? [])]; const cmd = patch.hooks.SessionStart[0].hooks[0].command;
  if (!list.some((g: any) => g.hooks?.some((h: any) => h.command === cmd))) list.push(patch.hooks.SessionStart[0]);
  out.hooks.SessionStart = list; return out;
}
export function applyMcp(cfg: CliConfig) {
  for (const c of setupCommands(cfg)) spawnSync(c[0], c.slice(1), { stdio: "inherit", shell: process.platform === "win32" });
}
export function installHook(exe: string, home = homedir()) {
  const f = join(home, ".claude", "settings.json"); mkdirSync(join(home, ".claude"), { recursive: true });
  const cur = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {};
  writeFileSync(f, JSON.stringify(mergeSettings(cur, hookSettingsPatch(exe)), null, 2));
}
```
`cli/src/autostart.ts`:
```ts
export function autostartSpec(platform: NodeJS.Platform, exe: string, home: string) {
  if (platform === "win32") return { kind: "schtasks" as const, files: [], commands: [["schtasks","/Create","/F","/SC","ONLOGON","/TN","TeamBridgeAgent","/TR",`"${exe}" agent`]] };
  if (platform === "darwin") {
    const path = `${home}/Library/LaunchAgents/ru.evapps.teambridge.plist`;
    const content = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Label</key><string>ru.evapps.teambridge</string>
<key>ProgramArguments</key><array><string>${exe}</string><string>agent</string></array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>${home}/.teambridge/agent.log</string><key>StandardErrorPath</key><string>${home}/.teambridge/agent.log</string></dict></plist>`;
    return { kind: "launchd" as const, files: [{ path, content }], commands: [["launchctl","load","-w",path]] };
  }
  const path = `${home}/.config/systemd/user/teambridge.service`;
  const content = `[Unit]\nDescription=TeamBridge agent\n[Service]\nExecStart=${exe} agent\nRestart=always\nRestartSec=10\n[Install]\nWantedBy=default.target\n`;
  return { kind: "systemd" as const, files: [{ path, content }], commands: [["systemctl","--user","daemon-reload"],["systemctl","--user","enable","--now","teambridge.service"]] };
}
```
`cli/src/hubClient.ts`:
```ts
import type { CliConfig } from "./config.js";
export const hubClient = (cfg: CliConfig) => ({
  async get<T>(path: string): Promise<T> {
    const r = await fetch(cfg.hub + path, { headers: { authorization: `Bearer ${cfg.token}` } });
    if (!r.ok) throw new Error(`Хаб ответил ${r.status}: ${await r.text()}`); return r.json() as Promise<T>;
  },
});
```
`cli/src/index.ts` (без `agent` — он в Task 11):
```ts
#!/usr/bin/env node
import { Command } from "commander";
import { mkdirSync, writeFileSync } from "node:fs"; import { dirname } from "node:path"; import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { readConfig, writeConfig } from "./config.js";
import { applyMcp, installHook } from "./setup.js";
import { autostartSpec } from "./autostart.js";
import { hubClient } from "./hubClient.js";
const exe = process.platform === "win32" ? "teambridge.cmd" : "teambridge";
const p = new Command("teambridge");
p.command("setup").requiredOption("--hub <url>").requiredOption("--invite <code>").action((o) => {
  const cfg = { hub: o.hub.replace(/\/$/, ""), inviteCode: o.invite }; writeConfig(cfg); applyMcp(cfg); installHook(exe);
  const spec = autostartSpec(process.platform, exe, homedir());
  for (const f of spec.files) { mkdirSync(dirname(f.path), { recursive: true }); writeFileSync(f.path, f.content); }
  for (const c of spec.commands) spawnSync(c[0], c.slice(1), { stdio: "inherit" });
  console.log("Готово. Откройте Claude Code и скажите: «Зарегистрируй меня в TeamBridge».");
});
p.command("save-token <token>").action((token) => {
  const cfg = readConfig(); if (!cfg) throw new Error("Сначала teambridge setup");
  const next = { hub: cfg.hub, token }; writeConfig(next); applyMcp(next);
  console.log("Токен сохранён. Перезапустите Claude Code; ответчик подхватит токен в течение минуты.");
});
p.command("digest").action(async () => {
  const cfg = readConfig(); if (!cfg?.token) return;
  try {
    const d: any = await hubClient(cfg).get("/api/digest");
    const lines = [
      ...d.decisions.slice(0, 5).map((x: any) => `• Итог${x.project ? ` (${x.project})` : ""}: ${x.summary.split("\n")[0]}`),
      ...d.needsHuman.map((x: any) => `• Нужен человек: #${x.id} ${x.subject}`),
      ...d.open.slice(0, 5).map((x: any) => `• Ждёт ответа: #${x.id} ${x.subject}`)];
    if (lines.length) console.log(["TeamBridge — пока тебя не было:", ...lines, "Подробнее: инструмент teambridge inbox / веб " + cfg.hub].join("\n"));
  } catch { /* хаб недоступен — сессию не ломаем */ }
});
p.command("status").action(async () => {
  const cfg = readConfig(); if (!cfg) return console.log("Не настроено: teambridge setup --hub … --invite …");
  console.log(`Хаб: ${cfg.hub}\nТокен: ${cfg.token ? "есть" : "нет (зарегистрируйтесь через Claude)"}`);
  if (cfg.token) console.log(JSON.stringify(await hubClient(cfg).get("/api/me"), null, 2));
});
p.parseAsync();
```
- [ ] **Step 3:** `npm test -w cli` → PASS. `npm run build -w cli`.
- [ ] **Step 4: Commit** `"CLI: setup (MCP, хук, автозапуск), save-token, digest, status"`.

---

### Task 11: CLI — ответчик (`teambridge agent`)

**Files:**
- Create: `cli/src/permissions.ts`, `cli/src/prompt.ts`, `cli/src/workspace.ts`, `cli/src/runner.ts`, `cli/src/agent.ts`
- Modify: `cli/src/index.ts` (команда `agent`)
- Test: `cli/test/permissions.test.ts`, `cli/test/workspace.test.ts`, `cli/test/agent.test.ts`, `cli/test/fake-claude.mjs`

**Interfaces:**
- Consumes: `readConfig`, протокол WS из Task 6.
- Produces:
  - `permissionSettings(): object` — JSON для `--settings`: `{ permissions: { allow: [...], deny: [...] } }`
  - `responderPrompt(a: { shortName: string; threadId: number; project?: string; hub: string }): string`
  - `prepareWorkspace(a: { jobId: number; threadId: number; subject?: string; project: { name: string; localPath: string | null } | null; root: string }): Promise<{ cwd: string; branch?: string; cleanup: () => Promise<void> }>`
  - `runClaude(a: { cwd: string; prompt: string; settings: object; timeoutMs: number; claudeBin?: string }): Promise<{ ok: boolean; error?: string; output: string }>`
  - `class Agent { constructor(cfg, opts: { root, claudeBin?, timeoutMs? }); start(): void; stop(): void }` — WS-клиент, переподключение через 5 с → 60 с (экспоненциально), очередь (по одному), `{type:"finished"}` после каждого задания.

Аргументы `claude`: `["-p", prompt, "--settings", JSON.stringify(settings), "--permission-mode", "acceptEdits", "--output-format", "text", "--max-turns", "40"]`. MCP `teambridge` уже прописан у пользователя (`-s user`), поэтому `claude -p` видит инструменты хаба.

- [ ] **Step 1: Падающие тесты**

`cli/test/permissions.test.ts`:
```ts
import { test, expect } from "vitest";
import { permissionSettings } from "../src/permissions.js";
test("запреты на месте", () => {
  const { permissions: p } = permissionSettings() as any;
  for (const d of ["Bash(git push origin main:*)","Bash(git push origin master:*)","Bash(git push origin dev:*)","Bash(git push --force:*)",
    "Bash(git push -f:*)","Bash(git merge:*)","Bash(rm -rf:*)","Bash(ssh:*)","Bash(docker:*)","Read(**/.env*)","Read(**/*.pem)","Read(**/id_*)","Read(**/credentials*)"])
    expect(p.deny).toContain(d);
  expect(p.allow).toEqual(expect.arrayContaining(["mcp__teambridge__*", "Bash(git commit:*)", "Bash(git push origin agent/*)", "Edit", "Read"]));
});
```
`cli/test/workspace.test.ts`: во временной папке создать «удалённый» репозиторий (`git init --bare`), клон с одним коммитом как `localPath`; `prepareWorkspace` создаёт worktree на ветке `agent/7-fix-date` из `origin/HEAD`, `cwd` существует и содержит файл коммита; `cleanup` удаляет worktree (`git worktree list` не содержит путь); проект `null` → пустая папка, `branch` undefined; `localPath` не существует → ошибка «Репозиторий проекта fin не найден по пути …».

`cli/test/fake-claude.mjs` (подменный `claude`): пишет полученные аргументы в `process.env.FAKE_LOG` и по `FAKE_MODE` = `ok` → exit 0, `fail` → exit 1 со stderr «boom», `hang` → бесконечное ожидание.

`cli/test/agent.test.ts`:
```ts
import { test, expect, afterEach } from "vitest";
import { WebSocketServer } from "ws";
import { mkdtempSync, readFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { Agent } from "../src/agent.js";
let wss: WebSocketServer; afterEach(() => wss?.close());
function fakeHub() {
  wss = new WebSocketServer({ port: 0 }); const got: any[] = []; let sock: any;
  wss.on("connection", (s) => { sock = s; s.on("message", (d) => { const m = JSON.parse(String(d)); got.push(m);
    if (m.type === "hello") s.send(JSON.stringify({ type: "ready", member: { id: 1, shortName: "Тест" } })); }); });
  return { url: `http://127.0.0.1:${(wss.address() as any).port}`, got, send: (m: any) => sock.send(JSON.stringify(m)) };
}
const until = async (f: () => boolean) => { for (let i = 0; i < 200 && !f(); i++) await new Promise((r) => setTimeout(r, 25)); };
test("задание без проекта: запуск claude и finished ok", async () => {
  const hub = fakeHub(); const root = mkdtempSync(join(tmpdir(), "tb-")); const log = join(root, "args.json");
  process.env.FAKE_LOG = log; process.env.FAKE_MODE = "ok";
  const a = new Agent({ hub: hub.url, token: "tb_t" }, { root, claudeBin: [process.execPath, join(__dirname, "fake-claude.mjs")], timeoutMs: 5000 });
  a.start(); await until(() => hub.got.some((m) => m.type === "hello"));
  hub.send({ type: "job", jobId: 5, threadId: 9, project: null });
  await until(() => hub.got.some((m) => m.type === "finished"));
  expect(hub.got.find((m) => m.type === "finished")).toEqual({ type: "finished", jobId: 5, ok: true });
  const args = JSON.parse(readFileSync(log, "utf8"));
  expect(args).toContain("-p"); expect(args.join(" ")).toContain("#9"); expect(args).toContain("--settings");
  a.stop();
});
test("ошибка и таймаут → finished ok:false", async () => {
  const hub = fakeHub(); const root = mkdtempSync(join(tmpdir(), "tb-"));
  process.env.FAKE_MODE = "hang";
  const a = new Agent({ hub: hub.url, token: "tb_t" }, { root, claudeBin: [process.execPath, join(__dirname, "fake-claude.mjs")], timeoutMs: 300 });
  a.start(); await until(() => hub.got.some((m) => m.type === "hello"));
  hub.send({ type: "job", jobId: 6, threadId: 1, project: null });
  await until(() => hub.got.some((m) => m.type === "finished"));
  expect(hub.got.find((m) => m.type === "finished")).toMatchObject({ jobId: 6, ok: false, error: expect.stringContaining("время") });
  a.stop();
});
test("два задания — по очереди", async () => { /* отправить два job подряд; FAKE_MODE=ok с задержкой 200мс (FAKE_DELAY);
  проверить по логу времени, что второй старт после первого finished */ });
```
(Третий тест реализовать полностью: `fake-claude` при `FAKE_DELAY` спит N мс и дописывает в `FAKE_LOG` строку `start <ts>`/`end <ts>`; проверка — интервалы не пересекаются.)

- [ ] **Step 2: Реализация**

`cli/src/permissions.ts`:
```ts
export function permissionSettings() {
  return { permissions: {
    allow: ["Read","Edit","Write","Glob","Grep","mcp__teambridge__*",
      "Bash(git status:*)","Bash(git diff:*)","Bash(git log:*)","Bash(git add:*)","Bash(git commit:*)","Bash(git checkout -b agent/*)",
      "Bash(git push origin agent/*)","Bash(git push -u origin agent/*)","Bash(glab mr create:*)","Bash(npm test:*)","Bash(npm run:*)"],
    deny: ["Bash(git push origin main:*)","Bash(git push origin master:*)","Bash(git push origin dev:*)","Bash(git push --force:*)","Bash(git push -f:*)",
      "Bash(git merge:*)","Bash(git rebase:*)","Bash(git reset --hard:*)","Bash(rm -rf:*)","Bash(ssh:*)","Bash(scp:*)","Bash(docker:*)",
      "Read(**/.env*)","Read(**/*.pem)","Read(**/id_*)","Read(**/credentials*)","Edit(**/.env*)"],
  } };
}
```
`cli/src/prompt.ts`:
```ts
export function responderPrompt(a: { shortName: string; threadId: number; project?: string; hub: string }) {
  return [
    `Ты — агент сотрудника ${a.shortName} в TeamBridge. Тебя запустили автоматически: в ветке #${a.threadId} для тебя новое сообщение.`,
    `1. Прочитай ветку инструментом teambridge thread (thread_id=${a.threadId}).`,
    a.project ? `2. Прочитай решения по проекту ${a.project}: teambridge decisions (project="${a.project}"). Ты в чистой копии репозитория ${a.project} — опирайся на код.` :
      `2. Прочитай журнал решений teambridge decisions по теме вопроса.`,
    `3. Ответь по существу через teambridge reply. Если вопрос текстовый — просто ответь, код не трогай.`,
    `4. Если для ответа нужна правка кода: правь в этой копии, коммить, пушь ТОЛЬКО свою ветку agent/* и открой MR (glab mr create), ссылки передай в reply.actions. Никогда не пушь в main/master/dev, не мержи, не делай force-push.`,
    `5. Если вы договорились или дальше обсуждать нечего — вызови teambridge decide с итогом: о чём договорились, что сделано (ссылки), что осталось открытым.`,
    `Не пересылай секреты (токены, пароли, ключи). Пиши по-русски, коротко и по делу. Хаб: ${a.hub}.`,
  ].join("\n");
}
```
`cli/src/workspace.ts`:
```ts
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs"; import { join } from "node:path";
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const slug = (s = "") => s.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, "-").replace(/^-|-$/g, "").slice(0, 30) || "task";
export async function prepareWorkspace(a: { jobId: number; threadId: number; subject?: string; project: { name: string; localPath: string | null } | null; root: string }) {
  const cwd = join(a.root, "work", String(a.jobId));
  if (!a.project) { mkdirSync(cwd, { recursive: true }); return { cwd, cleanup: async () => rmSync(cwd, { recursive: true, force: true }) }; }
  const repo = a.project.localPath;
  if (!repo || !existsSync(join(repo, ".git"))) throw new Error(`Репозиторий проекта ${a.project.name} не найден по пути ${repo ?? "(не указан)"}`);
  git(repo, "fetch", "origin", "--prune");
  const base = git(repo, "symbolic-ref", "--short", "refs/remotes/origin/HEAD");
  const branch = `agent/${a.threadId}-${slug(a.subject)}`;
  mkdirSync(join(a.root, "work"), { recursive: true });
  const exists = git(repo, "branch", "--list", branch);
  git(repo, "worktree", "add", ...(exists ? [cwd, branch] : ["-b", branch, cwd, base]));
  return { cwd, branch, cleanup: async () => { try { git(repo, "worktree", "remove", "--force", cwd); } catch { rmSync(cwd, { recursive: true, force: true }); git(repo, "worktree", "prune"); } } };
}
```
`cli/src/runner.ts`:
```ts
import { spawn } from "node:child_process";
export function runClaude(a: { cwd: string; prompt: string; settings: object; timeoutMs: number; claudeBin?: string[] }) {
  const [cmd, ...pre] = a.claudeBin ?? ["claude"];
  const args = [...pre, "-p", a.prompt, "--settings", JSON.stringify(a.settings), "--permission-mode", "acceptEdits", "--output-format", "text", "--max-turns", "40"];
  return new Promise<{ ok: boolean; error?: string; output: string }>((resolve) => {
    const ch = spawn(cmd, args, { cwd: a.cwd, shell: process.platform === "win32" && cmd === "claude", env: process.env });
    let out = "", err = "";
    ch.stdout.on("data", (d) => (out += d)); ch.stderr.on("data", (d) => (err += d));
    const t = setTimeout(() => { ch.kill(); resolve({ ok: false, error: `превышено время ответа (${Math.round(a.timeoutMs / 60000)} мин)`, output: out }); }, a.timeoutMs);
    ch.on("close", (code) => { clearTimeout(t); resolve(code === 0 ? { ok: true, output: out } : { ok: false, error: (err || out).slice(-500) || `код ${code}`, output: out }); });
  });
}
```
(Для таймаута `hang` в тесте строка ошибки содержит «время» — совпадает.)

`cli/src/agent.ts`:
```ts
import WebSocket from "ws";
import type { CliConfig } from "./config.js";
import { prepareWorkspace } from "./workspace.js";
import { runClaude } from "./runner.js";
import { permissionSettings } from "./permissions.js";
import { responderPrompt } from "./prompt.js";
type Job = { jobId: number; threadId: number; project: { name: string; localPath: string | null } | null };
export class Agent {
  private ws?: WebSocket; private queue: Job[] = []; private busy = false; private stopped = false; private delay = 5000; private shortName = "";
  constructor(private cfg: CliConfig, private opts: { root: string; claudeBin?: string[]; timeoutMs?: number }) {}
  start() {
    if (this.stopped) return;
    const ws = (this.ws = new WebSocket(this.cfg.hub.replace(/^http/, "ws") + "/agent"));
    ws.on("open", () => ws.send(JSON.stringify({ type: "hello", token: this.cfg.token })));
    ws.on("message", (d) => {
      const m = JSON.parse(String(d));
      if (m.type === "ready") { this.delay = 5000; this.shortName = m.member.shortName; log(`подключён как ${this.shortName}`); }
      if (m.type === "ping") ws.send(JSON.stringify({ type: "pong" }));
      if (m.type === "job") { this.queue.push(m); this.pump(); }
    });
    ws.on("close", (code) => {
      if (this.stopped) return;
      if (code === 4401) { log("токен отклонён хабом — выполните teambridge save-token"); this.delay = 60000; }
      setTimeout(() => this.start(), this.delay); this.delay = Math.min(this.delay * 2, 60000);
    });
    ws.on("error", () => {});
  }
  stop() { this.stopped = true; this.ws?.close(); }
  private async pump() {
    if (this.busy) return; const job = this.queue.shift(); if (!job) return;
    this.busy = true; let res: { ok: boolean; error?: string };
    let ws: Awaited<ReturnType<typeof prepareWorkspace>> | undefined;
    try {
      ws = await prepareWorkspace({ ...job, root: this.opts.root });
      res = await runClaude({ cwd: ws.cwd, prompt: responderPrompt({ shortName: this.shortName, threadId: job.threadId, project: job.project?.name, hub: this.cfg.hub }),
        settings: permissionSettings(), timeoutMs: this.opts.timeoutMs ?? 15 * 60 * 1000, claudeBin: this.opts.claudeBin });
    } catch (e: any) { res = { ok: false, error: e.message }; }
    finally { await ws?.cleanup().catch(() => {}); }
    this.ws?.send(JSON.stringify({ type: "finished", jobId: job.jobId, ok: res.ok, ...(res.ok ? {} : { error: res.error }) }));
    log(`задание ${job.jobId} (ветка #${job.threadId}): ${res.ok ? "готово" : "ошибка — " + res.error}`);
    this.busy = false; this.pump();
  }
}
const log = (s: string) => console.log(`[${new Date().toISOString()}] ${s}`);
```
`index.ts` — команда `agent`: читает конфиг каждые 60 с, пока нет токена (ждёт регистрации), затем `new Agent(cfg, { root: configDir() }).start()`.

- [ ] **Step 3:** `npm test -w cli` → PASS. `npm run build -w cli`.
- [ ] **Step 4: Commit** `"CLI: ответчик — рабочие копии, запуск claude -p с запретами, очередь"`.

---

### Task 12: README подключения, сквозная проверка, заметка проекта

**Files:**
- Create: `README.md`
- Create: `scripts/e2e.md` (пошаговая ручная проверка, результаты вписываются)

- [ ] **Step 1: `README.md`** — на одну страницу:
```markdown
# TeamBridge — подключение

Нужно: Node.js 20+, Claude Code (вход под своей подпиской), git; для MR от агента — `glab auth login` на git.evapps.ru.

1. Установить: `npm i -g git+<адрес репозитория teambridge>#main` (или `npm i -g ./teambridge-0.1.0.tgz`).
2. Настроить: `teambridge setup --hub http://10.10.140.2:8120 --invite <код команды>`
3. Открыть Claude Code и сказать: «Зарегистрируй меня в TeamBridge». Claude спросит, как вас записать, и предложит проекты из текущих папок. После — выполнит `teambridge save-token …`. Перезапустите Claude Code.
4. Проверить: `teambridge status`. Ответчик стартует сам при входе в систему (Windows — задача «TeamBridgeAgent»).

Как пользоваться: «спроси агента Димы по проекту fin, …», «что решили по fin», «что у меня в TeamBridge». Итоги показываются при старте Claude Code. Веб: http://10.10.140.2:8120 (вход своим токеном из `~/.teambridge/config.json`).

Что может ваш агент без вас: читать и править ваши репозитории в отдельной копии, коммитить и пушить только ветки `agent/*`, открывать MR. Нельзя: пушить в main/master/dev, мержить, force-push, читать .env и ключи.
```
- [ ] **Step 2: Сквозная проверка** (локально против хаба на 10.10.140.2):
  1. `npm run build && npm i -g ./cli` ; `teambridge setup --hub http://10.10.140.2:8120 --invite <код>`.
  2. В Claude Code: регистрация «Дмитрий Середа / Дмитрий», проект `teambridge` (local_path — этот репозиторий); `teambridge save-token`.
  3. Второй участник «Тест» на той же машине: отдельный `HOME`/`USERPROFILE` (`set USERPROFILE=%TEMP%\tb-test`), регистрация через MCP-тест-скрипт, проект `tb-sandbox` (временный git-репозиторий с bare-«origin»), запуск `teambridge agent` в отдельном терминале с этим окружением.
  4. Из своей сессии: `ask(to="Тест", subject="Текстовый вопрос", text="Сколько файлов в корне tb-sandbox?")` → в течение пары минут ответ в ветке; агент вызывает `decide`. Проверить: в вебе ветка `closed`, в журнале итог, новая сессия Claude Code показывает сводку.
  5. `ask(project="tb-sandbox", subject="Правка", text="Добавь файл HELLO.md с текстом привет и открой ветку")` → в bare-«origin» появилась ветка `agent/<id>-…` с коммитом; в ветке ссылка; `main` не изменился.
  6. Пинг-понг: попросить агентов «обсуждать без итога» — после 10 реплик ветка `needs_human`, новых запусков нет.
  Результаты (время ответа, ссылки) записать в `scripts/e2e.md`.
- [ ] **Step 3: Заметка второго мозга** — обновить `C:\Users\dsereda\obsidian\00 Second Brain\Projects\TeamBridge (мост между Claude-агентами).md`: что развёрнуто, адрес, где код приглашения, как подключать.
- [ ] **Step 4: Commit** `"README подключения и результаты сквозной проверки"`.

---

## Self-Review (выполнено при написании)

- Покрытие спецификации: хаб (MCP — Task 7, REST/веб — 7–8, WS — 6), данные (2), регистрация/код/админ/отзыв (3, 7), справочник (4), переписка/лимиты/маскирование/итоги/сводка (5), очередь/таймауты/лимит запусков/повтор (6), ответчик/worktree/запреты/очередь (11), setup/хук/автозапуск (10), деплой/бэкап (9), README/сквозная (12). Вне рамок — не реализуется.
- Имена согласованы: `JobSink`, `enqueueJob`, `nextJobFor`, `finishJob`, `requeueRunning`, `expireStale`, `AgentGateway.tick/notify/online`, `buildServer(pool,cfg)`, `buildMcp`, `registerRest`, `bearer`, `permissionSettings`, `responderPrompt`, `prepareWorkspace`, `runClaude`, `Agent`.
- Review Focus: 1 → Task 6 (`разрыв посреди задания`), 2 → Task 5 (`ошибки адресации`), 3 → Task 5 (`лимит реплик`), 4 → Task 7 (`отозванный ответчик отключается на ping`, `401 после revoke`), 5 → Task 2 (`mask`).
