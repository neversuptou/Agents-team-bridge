import { withTx, type Pool, type PoolClient } from "./db.js";
import type { Config } from "./config.js";
import { HubError, requireAdmin, type Member } from "./members.js";
import { projectOwners } from "./projects.js";
import { sanitize, findSecrets, findInjection } from "./guard.js";
import { audit } from "./audit.js";

export type Kind = "question" | "answer" | "status" | "note";
export type Action = { kind: "commit" | "mr" | "branch" | "link"; url: string; title?: string };
type Db = Pool | PoolClient;
const DELETED = "[удалено админом]";

// Общая проверка исходящего текста: чистка, размер, секреты (отказ + алерт), признаки инъекции (карантин)
async function checkContent(pool: Pool, cfg: Config, author: Member, parts: string[], target: string) {
  const clean = parts.map((p) => sanitize(p ?? ""));
  const bytes = clean.reduce((n, s) => n + Buffer.byteLength(s), 0);
  if (bytes > cfg.maxMessageBytes) throw new HubError("too_large", `Сообщение больше ${Math.round(cfg.maxMessageBytes / 1024)} КБ — сократите его`);
  const secrets = [...new Set(clean.flatMap(findSecrets))];
  if (secrets.length) {
    await pool.query("insert into alerts(kind,member_id,details) values('secret',$1,$2)", [author.id, `${target}: правила ${secrets.join(", ")}`]);
    await audit(pool, author.id, "message.reject_secret", target, { rules: secrets });
    throw new HubError("secret_detected", `Похоже на секрет (${secrets.join(", ")}): сообщение не принято, админ уведомлён. Уберите секрет и отправьте снова.`);
  }
  return { clean, injection: [...new Set(clean.flatMap(findInjection))] };
}

async function rateLimit(pool: Pool, cfg: Config, authorId: number) {
  const n = (await pool.query("select count(*)::int n from messages where author_id=$1 and created_at > now() - interval '1 hour'", [authorId])).rows[0].n;
  if (n >= cfg.maxMessagesPerHour) throw new HubError("rate_limited", `Не больше ${cfg.maxMessagesPerHour} сообщений в час — подождите`);
}

function checkActions(actions: Action[] = []) {
  if (actions.length > 5) throw new HubError("invalid_actions", "Не больше 5 ссылок");
  for (const a of actions) {
    if (!["commit", "mr", "branch", "link"].includes(a.kind)) throw new HubError("invalid_actions", "Неизвестный вид ссылки");
    const web = /^https?:\/\/[^\s]+$/i.test(a.url);
    const ref = /^[\w.\/-]{1,200}$/.test(a.url);
    if (!(web || ((a.kind === "branch" || a.kind === "commit") && ref))) throw new HubError("invalid_actions", "Ссылки — только http(s), имя ветки или коммит");
  }
  return actions;
}

// Сообщение в ветку внутри транзакции; ветка заблокирована вызывающим, счётчик реплик не гоняется
async function addMessage(c: PoolClient, cfg: Config, threadId: number, author: Member, text: string, kind: Kind, actions: Action[], injection: string[]) {
  const state = injection.length ? "quarantined" : "delivered";
  const m = (await c.query("insert into messages(thread_id,author_id,text,actions,kind,state) values($1,$2,$3,$4,$5,$6) returning id",
    [threadId, author.id, text, JSON.stringify(actions), kind, state])).rows[0];
  if (state === "quarantined") await c.query("insert into alerts(kind,member_id,message_id,details) values('injection',$1,$2,$3)",
    [author.id, m.id, `ветка #${threadId}: ${injection.join(", ")}`]);
  const t = (await c.query("update threads set turns=turns+1, updated_at=now() where id=$1 returning turns", [threadId])).rows[0];
  await c.query("update thread_participants set last_read_message_id=$3 where thread_id=$1 and member_id=$2", [threadId, author.id, m.id]);
  const status = t.turns >= cfg.maxTurns ? "needs_human" : "waiting";
  await c.query("update threads set status=$2 where id=$1", [threadId, status]);
  await audit(c, author.id, "message.add", `thread:${threadId}`, { messageId: m.id, kind, state });
  return { messageId: m.id as number, status, turns: t.turns as number, quarantined: state === "quarantined" };
}

// Вопрос — только в канале (проекте) Evapps, где состоят и автор, и получатель
export async function ask(pool: Pool, cfg: Config, from: Member, a: { to?: string; project: string; subject: string; text: string }) {
  if (!a.project?.trim()) throw new HubError("project_required", "Укажите проект Evapps: переписка идёт только в рамках проектов");
  const o = await projectOwners(pool, a.project);
  if (!o.isEvapps) throw new HubError("not_evapps", `«${o.name}» не проект Evapps: TeamBridge — только для проектов компании`);
  if (!o.ownerIds.includes(from.id)) throw new HubError("forbidden", `Вы не участник канала «${o.name}»: добавьте проект через my_projects и дождитесь подтверждения админа`);
  let recipient: number;
  if (a.to) {
    const m = (await pool.query("select id, short_name from members where revoked_at is null and (lower(short_name)=lower($1) or lower(full_name)=lower($1))", [a.to.trim()])).rows[0];
    if (!m) throw new HubError("unknown_member", `Нет участника «${a.to}»`);
    if (m.id === from.id) throw new HubError("self_ask", "Нельзя спросить самого себя");
    if (!o.ownerIds.includes(m.id)) throw new HubError("not_owner", `${m.short_name} не участник канала «${o.name}»`);
    recipient = m.id;
  } else {
    const others = o.ownerIds.filter((id) => id !== from.id);
    if (!others.length) throw new HubError("no_owners", `В канале «${o.name}» нет никого, кроме вас`);
    // меньше всего открытых веток — тот и отвечает
    recipient = (await pool.query(`select m.id from members m where m.id = any($1) order by
      (select count(*) from thread_participants tp join threads t on t.id=tp.thread_id where tp.member_id=m.id and t.status in ('waiting','open')), m.id limit 1`,
      [others])).rows[0].id;
  }
  await rateLimit(pool, cfg, from.id);
  const { clean: [subject, text], injection } = await checkContent(pool, cfg, from, [a.subject, a.text], `ask:${o.name}`);
  if (!subject.trim() || !text.trim()) throw new HubError("empty", "Нужны тема и текст");
  return withTx(pool, async (c) => {
    const t = (await c.query("insert into threads(subject,project_id,created_by,status) values($1,$2,$3,'waiting') returning id",
      [subject.trim(), o.projectId, from.id])).rows[0];
    await c.query("insert into thread_participants(thread_id,member_id) values($1,$2),($1,$3)", [t.id, from.id, recipient]);
    const r = await addMessage(c, cfg, t.id, from, text, "question", [], injection);
    const name = (await c.query("select short_name from members where id=$1", [recipient])).rows[0].short_name as string;
    return {
      threadId: t.id as number, recipientShortName: name, status: r.quarantined ? "quarantined" : "waiting",
      note: r.quarantined ? "Сообщение похоже на попытку управлять чужим Claude и ждёт проверки админом"
        : `Запрос отправлен. ${name} увидит его, когда сам примет запрос; ответ придёт в эту ветку.`,
    };
  });
}

async function loadThread(pool: Pool, me: Member, threadId: number, opts: { asAdmin?: boolean } = {}) {
  const t = (await pool.query("select t.*, p.name project from threads t left join projects p on p.id=t.project_id where t.id=$1", [threadId])).rows[0];
  if (!t) throw new HubError("unknown_thread", "Ветка не найдена");
  if (opts.asAdmin && me.isAdmin) return t;
  const p = await pool.query("select 1 from thread_participants where thread_id=$1 and member_id=$2", [threadId, me.id]);
  if (!p.rowCount) throw new HubError("forbidden", "Вы не участник ветки");
  if (t.created_by !== me.id && !t.accepted_at)
    throw new HubError("not_accepted", "Запрос ещё не принят: человек-получатель должен сам принять его (respond_request или веб-лента)");
  return t;
}

// Входящие запросы, которые ждут решения человека-получателя (в карантине — не показываются)
export async function pendingRequests(pool: Pool, me: Member) {
  const r = await pool.query(`select t.id, t.subject, p.name project, m.short_name "from", q.text question
    from threads t join thread_participants tp on tp.thread_id=t.id and tp.member_id=$1
    join members m on m.id=t.created_by left join projects p on p.id=t.project_id
    join lateral (select text, state from messages where thread_id=t.id order by id limit 1) q on true
    where t.created_by<>$1 and t.accepted_at is null and t.status='waiting' and q.state='delivered' order by t.id`, [me.id]);
  return r.rows.map((x) => ({ id: x.id as number, subject: x.subject as string, project: x.project as string, from: x.from as string, question: x.question as string }));
}

// Принять или отклонить запрос — решение человека-получателя
export async function respond(pool: Pool, me: Member, threadId: number, accept: boolean) {
  const t = (await pool.query("select * from threads where id=$1", [threadId])).rows[0];
  const p = t ? await pool.query("select 1 from thread_participants where thread_id=$1 and member_id=$2", [threadId, me.id]) : null;
  if (!t || !p?.rowCount || t.created_by === me.id) throw new HubError("forbidden", "Принять или отклонить запрос может только его получатель");
  if (t.accepted_at || t.status !== "waiting") throw new HubError("already_answered", "Запрос уже принят или закрыт");
  await pool.query(accept ? "update threads set accepted_at=now(), updated_at=now() where id=$1" : "update threads set status='rejected', updated_at=now() where id=$1", [threadId]);
  await audit(pool, me.id, accept ? "request.accept" : "request.reject", `thread:${threadId}`);
  return { threadId, accepted: accept };
}

export async function reply(pool: Pool, cfg: Config, from: Member, a: { threadId: number; text: string; kind?: Exclude<Kind, "question">; actions?: Action[] }) {
  const t = await loadThread(pool, from, a.threadId);
  if (t.status === "closed" || t.status === "rejected") throw new HubError("thread_closed", "Ветка закрыта");
  if (t.status === "needs_human") throw new HubError("needs_human", "Ветка упёрлась в лимит реплик, нужен человек");
  const actions = checkActions(a.actions);
  await rateLimit(pool, cfg, from.id);
  const { clean: [text, ...rest], injection } = await checkContent(pool, cfg, from,
    [a.text, ...actions.flatMap((x) => [x.url, x.title ?? ""])], `reply:thread:${a.threadId}`);
  if (!text.trim()) throw new HubError("empty", "Пустой ответ");
  const cleanActions = actions.map((x, i) => ({ kind: x.kind, url: rest[i * 2], ...(x.title ? { title: rest[i * 2 + 1] } : {}) }));
  const kind = a.kind && ["answer", "status", "note"].includes(a.kind) ? a.kind : "answer";
  return withTx(pool, async (c) => {
    const cur = (await c.query("select status from threads where id=$1 for update", [a.threadId])).rows[0];
    if (cur.status !== "waiting" && cur.status !== "open") throw new HubError("thread_closed", "Ветка уже закрыта");
    const r = await addMessage(c, cfg, a.threadId, from, text, kind, cleanActions, injection);
    return { ...r, note: r.quarantined ? "Сообщение ждёт проверки админом" : undefined };
  });
}

export async function decide(pool: Pool, cfg: Config, from: Member, a: { threadId: number; summary: string; links?: string[] }) {
  const t = await loadThread(pool, from, a.threadId);
  if (t.status === "closed" || t.status === "rejected") throw new HubError("thread_closed", "Ветка уже закрыта");
  const links = (a.links ?? []).slice(0, 5);
  if (links.some((l) => !/^https?:\/\/\S+$/i.test(l))) throw new HubError("invalid_actions", "Ссылки — только http(s)");
  const { clean: [summary, ...cleanLinks], injection } = await checkContent(pool, cfg, from, [a.summary, ...links], `decide:thread:${a.threadId}`);
  if (injection.length) {
    await pool.query("insert into alerts(kind,member_id,details) values('injection',$1,$2)", [from.id, `итог ветки #${a.threadId}: ${injection.join(", ")}`]);
    throw new HubError("injection_suspected", "Итог похож на инструкцию для чужого Claude и не принят; админ уведомлён");
  }
  return withTx(pool, async (c) => {
    const cur = (await c.query("select status from threads where id=$1 for update", [a.threadId])).rows[0];
    if (cur.status === "closed" || cur.status === "rejected") throw new HubError("thread_closed", "Ветка уже закрыта");
    const d = await c.query("insert into decisions(thread_id,project_id,summary,links,created_by) values($1,$2,$3,$4,$5) returning id",
      [a.threadId, t.project_id, summary, JSON.stringify(cleanLinks), from.id]);
    await c.query("update threads set status='closed', updated_at=now() where id=$1", [a.threadId]);
    await audit(c, from.id, "decision.add", `thread:${a.threadId}`, { decisionId: d.rows[0].id });
    return { decisionId: d.rows[0].id as number };
  });
}

const shownText = (x: any, me: Member, asAdmin: boolean): string | null =>
  x.state === "deleted" ? DELETED
    : x.state === "quarantined" ? (x.author_id === me.id || asAdmin ? `[на проверке у админа] ${x.text}` : null)
      : x.text;

export async function getThread(pool: Pool, me: Member, threadId: number, opts: { asAdmin?: boolean } = {}) {
  const t = await loadThread(pool, me, threadId, opts);
  const asAdmin = !!(opts.asAdmin && me.isAdmin);
  const parts = await pool.query(`select m.short_name from thread_participants tp join members m on m.id=tp.member_id
    where tp.thread_id=$1 order by m.id`, [threadId]);
  const msgs = await pool.query(`select ms.*, m.short_name author from messages ms join members m on m.id=ms.author_id
    where thread_id=$1 order by ms.id`, [threadId]);
  const dec = await pool.query("select summary from decisions where thread_id=$1 order by id desc limit 1", [threadId]);
  const messages = msgs.rows
    .map((x) => ({ id: x.id as number, author: x.author as string, kind: x.kind as Kind, text: shownText(x, me, asAdmin),
      actions: (x.state === "delivered" ? x.actions : []) as Action[], createdAt: x.created_at as Date }))
    .filter((m): m is typeof m & { text: string } => m.text !== null);
  return {
    id: t.id as number, subject: t.subject as string, project: t.project as string | null, status: t.status as string, turns: t.turns as number,
    accepted: !!t.accepted_at, participants: parts.rows.map((x) => x.short_name as string), messages,
    decision: dec.rows[0]?.summary as string | undefined,
  };
}

export async function listThreads(pool: Pool, me: Member) {
  return (await pool.query(`select t.id, t.subject, t.status, t.turns, t.updated_at, p.name project,
      (t.created_by<>$1 and t.accepted_at is null and t.status='waiting') pending
    from threads t join thread_participants tp on tp.thread_id=t.id and tp.member_id=$1 left join projects p on p.id=t.project_id
    order by t.updated_at desc limit 200`, [me.id])).rows;
}

// Новое для участника: запросы на решение, ветки с непрочитанными, новые итоги; помечает прочитанным ровно то, что вернул
export async function inbox(pool: Pool, me: Member) {
  const rows = (await pool.query(`select t.id, t.subject, t.status, count(m.id)::int new_messages, max(m.id) max_id
    from threads t join thread_participants tp on tp.thread_id=t.id and tp.member_id=$1
    join messages m on m.thread_id=t.id and m.id>tp.last_read_message_id and m.author_id<>$1 and m.state<>'quarantined'
    where t.created_by=$1 or t.accepted_at is not null group by t.id order by max(m.id) desc`, [me.id])).rows;
  for (const r of rows) await pool.query("update thread_participants set last_read_message_id=greatest(last_read_message_id,$3) where thread_id=$1 and member_id=$2", [r.id, me.id, r.max_id]);
  const key = `inbox_decision_${me.id}`;
  const decs = (await pool.query(`select d.id, d.thread_id, d.summary from decisions d
    join thread_participants tp on tp.thread_id=d.thread_id and tp.member_id=$1
    where d.id > coalesce((select value::int from settings where key=$2), 0) order by d.id`, [me.id, key])).rows;
  if (decs.length) await pool.query(`insert into settings(key,value) values($1,$2) on conflict(key) do update set value=excluded.value`,
    [key, String(decs[decs.length - 1].id)]);
  return {
    requests: await pendingRequests(pool, me),
    threads: rows.map((r) => ({ id: r.id as number, subject: r.subject as string, status: r.status as string, newMessages: r.new_messages as number })),
    decisions: decs.map((r) => ({ threadId: r.thread_id as number, summary: r.summary as string })),
  };
}

// Журнал решений: ветки, где я участник, и каналы, где я подтверждённый участник
export async function listDecisions(pool: Pool, me: Member, a: { project?: string; query?: string; limit?: number }) {
  const r = await pool.query(`select d.id, d.thread_id, p.name project, d.summary, d.links, d.created_at
    from decisions d left join projects p on p.id=d.project_id
    where (exists (select 1 from thread_participants tp where tp.thread_id=d.thread_id and tp.member_id=$4)
        or exists (select 1 from member_projects mp where mp.project_id=d.project_id and mp.member_id=$4 and mp.approved))
      and ($1::text is null or lower(p.name)=lower($1)) and ($2::text is null or d.summary ilike '%'||$2||'%')
    order by d.id desc limit $3`, [a.project ?? null, a.query ?? null, Math.min(a.limit ?? 50, 200), me.id]);
  return r.rows.map((x) => ({ id: x.id, threadId: x.thread_id, project: x.project, summary: x.summary, links: x.links, createdAt: x.created_at }));
}

// --- админ: карантин, удаление, алерты, срок хранения ---

export async function listQuarantine(pool: Pool) {
  const r = await pool.query(`select ms.id, ms.thread_id, ms.text, ms.kind, m.short_name author, ms.created_at from messages ms
    join members m on m.id=ms.author_id where ms.state='quarantined' order by ms.id`);
  return r.rows.map((x) => ({ id: x.id as number, threadId: x.thread_id as number, author: x.author as string, kind: x.kind, text: x.text as string, createdAt: x.created_at }));
}

async function purgeMessage(db: Db, id: number) {
  await db.query("update messages set state='deleted', text='', actions='[]' where id=$1", [id]);
}

export async function resolveQuarantine(pool: Pool, admin: Member, messageId: number, approve: boolean) {
  await requireAdmin(pool, admin.id);
  const r = await pool.query("select id from messages where id=$1 and state='quarantined'", [messageId]);
  if (!r.rowCount) throw new HubError("unknown_message", "Нет такого сообщения в карантине");
  if (approve) await pool.query("update messages set state='delivered' where id=$1", [messageId]);
  else await purgeMessage(pool, messageId);
  await pool.query("update alerts set resolved_at=now() where message_id=$1 and resolved_at is null", [messageId]);
  await audit(pool, admin.id, approve ? "quarantine.approve" : "quarantine.reject", `message:${messageId}`);
}

// Удалить утёкшее сообщение у всех: текст стирается, в ветке остаётся «[удалено админом]»
export async function deleteMessage(pool: Pool, admin: Member, messageId: number) {
  await requireAdmin(pool, admin.id);
  const r = await pool.query("select 1 from messages where id=$1", [messageId]);
  if (!r.rowCount) throw new HubError("unknown_message", "Нет такого сообщения");
  await purgeMessage(pool, messageId);
  await audit(pool, admin.id, "message.delete", `message:${messageId}`);
}

export async function deleteDecision(pool: Pool, admin: Member, decisionId: number) {
  await requireAdmin(pool, admin.id);
  const r = await pool.query("delete from decisions where id=$1", [decisionId]);
  if (!r.rowCount) throw new HubError("unknown_decision", "Нет такого итога");
  await audit(pool, admin.id, "decision.delete", `decision:${decisionId}`);
}

export async function listAlerts(pool: Pool) {
  const r = await pool.query(`select a.id, a.kind, a.details, a.message_id, a.resolved_at, a.created_at, m.short_name member
    from alerts a left join members m on m.id=a.member_id order by (a.resolved_at is null) desc, a.id desc limit 100`);
  return r.rows.map((x) => ({ id: x.id as number, kind: x.kind as string, member: x.member as string, details: x.details as string,
    messageId: x.message_id as number | null, resolved: !!x.resolved_at, createdAt: x.created_at }));
}

export async function resolveAlert(pool: Pool, admin: Member, alertId: number) {
  await requireAdmin(pool, admin.id);
  await pool.query("update alerts set resolved_at=now() where id=$1", [alertId]);
}

// Срок хранения: ветки без активности дольше retentionDays удаляются целиком (журнал аудита остаётся)
export async function purgeOld(pool: Pool, cfg: Config) {
  return withTx(pool, async (c) => {
    const ids = (await c.query("select id from threads where updated_at < now() - make_interval(days => $1)", [cfg.retentionDays])).rows.map((x) => x.id);
    if (ids.length) {
      for (const tbl of ["decisions", "messages", "thread_participants"]) await c.query(`delete from ${tbl} where thread_id = any($1)`, [ids]);
      await c.query("delete from threads where id = any($1)", [ids]);
      await audit(c, null, "retention.purge", undefined, { threads: ids.length });
    }
    await c.query("delete from alerts where resolved_at < now() - make_interval(days => $1)", [cfg.retentionDays]);
    return ids.length;
  });
}
