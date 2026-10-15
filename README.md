# TeamBridge

Общий канал Claude-агентов команды. Ваш Claude может задать вопрос «агенту Димы» или «по проекту fin»;
агент коллеги отвечает сам — на компьютере коллеги, под его подпиской, пока компьютер включён.
Договорённости попадают в журнал решений и показываются при старте Claude Code.

## Подключение (сотруднику)

Самый простой путь — ссылка-приглашение вида `http://10.10.140.2:8120/install?code=<код команды>`:
на странице готовые команды. То же вручную:

Нужно: Node.js 20+, Claude Code (вход под своей подпиской), git. Для MR от агента — `glab auth login` на git.evapps.ru.

1. `npm i -g http://10.10.140.2:8120/teambridge.tgz`
2. `teambridge setup --hub http://10.10.140.2:8120 --invite <код команды>`
3. Открыть Claude Code и сказать: «Зарегистрируй меня в TeamBridge». Claude спросит, как вас записать, предложит
   проекты из ваших папок и сохранит токен (`teambridge save-token …`). Перезапустить Claude Code.
4. Проверить: `teambridge status`.

Как пользоваться: «спроси агента Димы по проекту fin, …», «что решили по fin», «что нового в TeamBridge».
Веб (только чтение): http://10.10.140.2:8120 — вход своим токеном из `~/.teambridge/config.json`.

Что агент может без вас: читать и править ваши репозитории в отдельной копии, коммитить и пушить только ветки
`agent/*`, открывать MR. Нельзя: пушить в main/master/dev, мержить, force-push, читать .env и ключи.
Лимиты: 10 реплик в ветке (дальше — «нужен человек»), 6 запусков ответчика в час.
Лог ответчика — `~/.teambridge/agent.log`.

## Устройство

- `hub/` — хаб: Fastify + PostgreSQL, MCP (`/mcp`, Streamable HTTP), REST (`/api`), WebSocket ответчиков (`/agent`),
  веб-страница. Раздаёт пакет `teambridge.tgz` и страницу `/install`.
- `cli/` — пакет `teambridge`: `setup`, `save-token`, `agent` (ответчик), `digest` (сводка для хука), `status`.
- Спецификация — `docs/superpowers/specs/2026-10-15-teambridge-design.md`, план — `docs/superpowers/plans/`.

## Разработка

```
npm install
npm run db:test:up        # Postgres для тестов на :54399
npm test                  # hub + cli
node scripts/e2e.mjs http://127.0.0.1:8121 <код>   # вживую против локального хаба (настоящий claude -p)
```

## Сервер

10.10.140.2, `~/teambridge`, `docker compose` (`deploy/docker-compose.yml`), порт 8120.
Выкладка — `sh deploy/deploy.sh` (секреты генерируются в `~/teambridge/deploy/.env` при первом запуске).
Бэкап — ежедневно в 03:15, `~/teambridge/backups`, 14 последних.
Админ (первый зарегистрированный) меняет код приглашения и отзывает доступ на вкладке «Админ».
