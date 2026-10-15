// Подтверждение человеком всего, что уходит с машины в TeamBridge.
// Окно показывает сам Claude Code (MCP elicitation) — Claude не может ответить в нём за человека.
export type Elicit = (message: string) => Promise<boolean>;
export type Gate = { ok: true } | { ok: false; reason: string };

const READ_ONLY = new Set(["whoami", "directory", "inbox", "thread", "requests", "decisions"]);
const clip = (s: unknown, n = 6000) => { const t = String(s ?? ""); return t.length > n ? t.slice(0, n) + "\n…(обрезано в окне, уйдёт целиком)" : t; };
const refused: Gate = { ok: false, reason: "Человек не подтвердил — ничего не отправлено. Не повторяй отправку без его просьбы." };

function describe(name: string, a: any): { message: string; evappsCheck: boolean; text?: string } | null {
  switch (name) {
    case "ask":
      return { evappsCheck: false, message: `TeamBridge: отправить вопрос ${a.to ? `коллеге ${a.to}` : "участнику канала"} в проекте «${a.project}»?\nТема: ${clip(a.subject, 200)}\n\n${clip(a.text)}` };
    case "reply": {
      const links = (a.actions ?? []).map((x: any) => `\n• ${x.kind}: ${x.title ?? ""} ${x.url}`).join("");
      return { evappsCheck: true, text: a.text, message: `TeamBridge: отправить ответ в ветку #${a.thread_id}?\n\n${clip(a.text)}${links}` };
    }
    case "decide":
      return { evappsCheck: true, text: a.summary, message: `TeamBridge: записать итог ветки #${a.thread_id} в журнал решений (его увидят участники канала)?\n\n${clip(a.summary)}${(a.links ?? []).map((l: string) => `\n• ${l}`).join("")}` };
    case "respond_request":
      return { evappsCheck: false, message: `TeamBridge: ${a.accept ? "Принять" : "Отклонить"} запрос #${a.thread_id}? ${a.accept ? "После этого ваш Claude увидит вопрос коллеги и сможет готовить ответ (каждую отправку вы подтверждаете отдельно)." : ""}` };
    case "my_projects":
      return { evappsCheck: false, message: `TeamBridge: изменить список ваших проектов?${(a.add ?? []).map((p: any) => `\n+ ${p.name}${p.git_remote ? ` (${p.git_remote})` : ""}`).join("")}${(a.remove ?? []).map((p: string) => `\n− ${p}`).join("")}` };
    default:
      return null;
  }
}

export async function confirmOutgoing(name: string, args: any, elicit: Elicit): Promise<Gate> {
  if (READ_ONLY.has(name)) return { ok: true };
  const d = describe(name, args ?? {});
  if (!d) return { ok: false, reason: `Инструмент «${name}» не разрешён` };
  if (!(await elicit(d.message))) return refused;
  // всё, что не помечено как информация о проектах Evapps, — только с отдельного согласия
  if (d.evappsCheck && args?.about_evapps !== true) {
    const again = `Отдельное согласие. Claude отметил, что в этом тексте есть информация НЕ о проектах Evapps (или не указал этого). Отправить её коллегам всё равно?\n\n${clip(d.text)}`;
    if (!(await elicit(again))) return refused;
  }
  return { ok: true };
}
