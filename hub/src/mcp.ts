import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Pool } from "./db.js";
import type { Config } from "./config.js";
import { HubError, register, type Member } from "./members.js";
import { setMyProjects, myProjects, directory } from "./projects.js";
import * as threads from "./threads.js";
import type { AgentGateway } from "./agentGateway.js";

const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
// Ошибки предметной области — понятный текст инструменту (isError), остальное — наружу
const wrap = (fn: (a: any) => Promise<unknown>) => async (a: any) => {
  try { return ok(await fn(a)); }
  catch (e) {
    if (e instanceof HubError) return { isError: true, content: [{ type: "text" as const, text: e.message }] };
    throw e;
  }
};
const projectSchema = z.object({ name: z.string(), git_remote: z.string().optional(), local_path: z.string().optional() });
const toInput = (p: { name: string; git_remote?: string; local_path?: string }) => ({ name: p.name, gitRemote: p.git_remote, localPath: p.local_path });

/*
  MCP-сервер на один запрос. Без токена (только код приглашения) доступна лишь регистрация;
  с токеном — справочник, переписка и журнал решений от имени этого участника.
*/
export function buildMcp(pool: Pool, cfg: Config, gateway: AgentGateway, sink: threads.JobSink, auth: { member?: Member; inviteCode?: string }) {
  const s = new McpServer({ name: "teambridge", version: "0.1.0" });

  if (!auth.member) {
    s.registerTool("register", {
      description: "Зарегистрироваться в TeamBridge (общий канал Claude-агентов команды). Сначала спросите у человека, как его записать: полное имя (Иван Иванов) и короткое имя для обращения (Иван). Предложите проекты по git remote папок, где он работает (name, git_remote, local_path — путь на этой машине), и подтвердите с человеком.",
      inputSchema: { full_name: z.string(), short_name: z.string(), projects: z.array(projectSchema).optional() },
    }, wrap(async (a) => {
      const r = await register(pool, cfg, { inviteCode: auth.inviteCode ?? "", fullName: a.full_name, shortName: a.short_name });
      if (a.projects?.length) await setMyProjects(pool, r.member.id, { add: a.projects.map(toInput) });
      return { token: r.token, member: r.member, next: `Сохраните токен: выполните в терминале \`teambridge save-token ${r.token}\`, затем попросите человека перезапустить Claude Code` };
    }));
    return s;
  }

  const me = auth.member;
  s.registerTool("whoami", { description: "Мой профиль и проекты в TeamBridge", inputSchema: {} },
    wrap(async () => ({ ...me, projects: await myProjects(pool, me.id) })));
  s.registerTool("directory", {
    description: "Справочник TeamBridge: люди, их проекты, кто в сети. query — поиск по имени или проекту.",
    inputSchema: { query: z.string().optional() },
  }, wrap(async (a) => directory(pool, gateway.online(), a.query)));
  s.registerTool("my_projects", {
    description: "Добавить или убрать мои проекты: name, git_remote, local_path (путь к репозиторию на моей машине — там будет работать мой агент).",
    inputSchema: { add: z.array(projectSchema).optional(), remove: z.array(z.string()).optional() },
  }, wrap(async (a) => setMyProjects(pool, me.id, { add: a.add?.map(toInput), remove: a.remove })));
  s.registerTool("ask", {
    description: "Задать вопрос агенту коллеги. to — имя коллеги, project — проект (хаб выберет владельца). Ответ придёт в ветку автоматически, когда компьютер коллеги включён. Перед вопросом проверьте decisions по проекту.",
    inputSchema: { to: z.string().optional(), project: z.string().optional(), subject: z.string(), text: z.string() },
  }, wrap(async (a) => threads.ask(pool, cfg, sink, me, a, gateway.online())));
  s.registerTool("reply", {
    description: "Ответить в ветке. actions — ссылки на коммиты, MR, ветки.",
    inputSchema: {
      thread_id: z.number(), text: z.string(),
      actions: z.array(z.object({ kind: z.enum(["commit", "mr", "branch", "link"]), url: z.string(), title: z.string().optional() })).optional(),
    },
  }, wrap(async (a) => threads.reply(pool, cfg, sink, me, { threadId: a.thread_id, text: a.text, actions: a.actions })));
  s.registerTool("thread", { description: "Прочитать ветку целиком", inputSchema: { thread_id: z.number() } },
    wrap(async (a) => threads.getThread(pool, me, a.thread_id)));
  s.registerTool("inbox", { description: "Новое для меня в TeamBridge: ветки с непрочитанными сообщениями и новые итоги", inputSchema: {} },
    wrap(async () => threads.inbox(pool, me)));
  s.registerTool("decide", {
    description: "Записать итог ветки в журнал решений (о чём договорились, что сделано со ссылками, что осталось открытым) и закрыть ветку.",
    inputSchema: { thread_id: z.number(), summary: z.string(), links: z.array(z.string()).optional() },
  }, wrap(async (a) => threads.decide(pool, me, { threadId: a.thread_id, summary: a.summary, links: a.links })));
  s.registerTool("decisions", {
    description: "Журнал решений команды: по проекту и/или поиск по тексту.",
    inputSchema: { project: z.string().optional(), query: z.string().optional() },
  }, wrap(async (a) => threads.listDecisions(pool, a)));
  return s;
}
