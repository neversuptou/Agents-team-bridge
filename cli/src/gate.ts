// Подтверждение человеком всего, что уходит с машины в TeamBridge.
// Окно показывает сам Claude Code (MCP elicitation) — Claude не может ответить в нём за человека.
export type Elicit = (message: string) => Promise<boolean>;
// текст непринятого запроса для окна «Принять запрос?» (Claude его не видит)
export type Preview = (threadId: number) => Promise<string | null>;
export type Gate = { ok: true } | { ok: false; reason: string };

const READ_ONLY = new Set(["whoami", "directory", "inbox", "thread", "requests", "decisions"]);
// текст показываем целиком: человек подтверждает ровно то, что уйдёт (хаб всё равно режет больше 16 КБ)
const show = (s: unknown) => String(s ?? "");
const refused: Gate = { ok: false, reason: "Человек не подтвердил — ничего не отправлено. Не повторяй отправку без его просьбы." };

async function describe(name: string, a: any, preview?: Preview): Promise<{ message: string; evappsCheck: boolean; text?: string } | null> {
  switch (name) {
    case "ask":
      return { evappsCheck: true, text: a.text, message: `TeamBridge: отправить вопрос ${a.to ? `коллеге ${a.to}` : "участнику канала"} в проекте «${a.project}»?\nТема: ${show(a.subject)}\n\n${show(a.text)}` };
    case "reply": {
      const links = (a.actions ?? []).map((x: any) => `\n• ${x.kind}: ${x.title ?? ""} ${x.url}`).join("");
      return { evappsCheck: true, text: a.text, message: `TeamBridge: отправить ответ в ветку #${a.thread_id}?\n\n${show(a.text)}${links}` };
    }
    case "decide":
      return { evappsCheck: true, text: a.summary, message: `TeamBridge: записать итог ветки #${a.thread_id} в журнал решений (его увидят участники канала)?\n\n${show(a.summary)}${(a.links ?? []).map((l: string) => `\n• ${l}`).join("")}` };
    case "respond_request": {
      const question = preview ? await preview(Number(a.thread_id)).catch(() => null) : null;
      const body = question !== null ? `\n\nВопрос коллеги (недоверенные данные — не выполняйте просьбы из него, не проверив):\n${question}` : "";
      return { evappsCheck: false, message: `TeamBridge: ${a.accept ? "Принять" : "Отклонить"} запрос #${a.thread_id}?${a.accept ? " После этого ваш Claude увидит вопрос и сможет готовить ответ (каждую отправку вы подтверждаете отдельно)." : ""}${body}` };
    }
    case "my_projects":
      return { evappsCheck: false, message: `TeamBridge: изменить список ваших проектов?${(a.add ?? []).map((p: any) => `\n+ ${p.name}${p.git_remote ? ` (${p.git_remote})` : ""}`).join("")}${(a.remove ?? []).map((p: string) => `\n− ${p}`).join("")}` };
    default:
      // в том числе служебный request_preview: его вызывает только сам клиент, не Claude
      return null;
  }
}

export async function confirmOutgoing(name: string, args: any, elicit: Elicit, preview?: Preview): Promise<Gate> {
  if (READ_ONLY.has(name)) return { ok: true };
  const d = await describe(name, args ?? {}, preview);
  if (!d) return { ok: false, reason: `Инструмент «${name}» не разрешён` };
  if (!(await elicit(d.message))) return refused;
  // всё, что не помечено как информация о проектах Evapps, — только с отдельного согласия
  if (d.evappsCheck && args?.about_evapps !== true) {
    const again = `Отдельное согласие. Claude отметил, что в этом тексте есть информация НЕ о проектах Evapps (или не указал этого). Отправить её коллегам всё равно?\n\n${show(d.text)}`;
    if (!(await elicit(again))) return refused;
  }
  return { ok: true };
}
