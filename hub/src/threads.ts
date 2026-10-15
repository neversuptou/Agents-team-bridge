import type { Pool } from "./db.js";
import type { Config } from "./config.js";
import { HubError, type Member } from "./members.js";
import { projectOwners } from "./projects.js";
import { maskSecrets } from "./mask.js";

// Кому теперь отвечать в ветке: реализация ставит задание ответчику участника
export type JobSink = (threadId: number, memberId: number) => Promise<void>;
export type Action = { kind: "commit" | "mr" | "branch" | "link"; url: string; title?: string };

async function findMember(pool: Pool, name: string) {
  const r = await pool.query(
    "select id, short_name from members where revoked_at is null and (lower(short_name)=lower($1) or lower(full_name)=lower($1))",
    [name.trim()]);
  if (!r.rows[0]) throw new HubError("unknown_member", `Нет участника «${name}»`);
  return { id: r.rows[0].id as number, shortName: r.rows[0].short_name as string };
}

// Из владельцев проекта — тот, кто в сети и с наименьшей очередью; никого в сети — первый по id
async function pickOwner(pool: Pool, ownerIds: number[], online: Set<number>) {
  const r = await pool.query(`select m.id,
      (select count(*) from jobs j where j.member_id=m.id and j.status in ('queued','running'))::int load
    from members m where m.id = any($1) order by m.id`, [ownerIds]);
  const rows = r.rows as { id: number; load: number }[];
  const on = rows.filter((x) => online.has(x.id)).sort((a, b) => a.load - b.load);
  return (on[0] ?? rows[0]).id;
}

async function addMessage(pool: Pool, cfg: Config, sink: JobSink, threadId: number, authorId: number, text: string, actions: Action[]) {
  await pool.query("insert into messages(thread_id,author_id,text,actions) values($1,$2,$3,$4)",
    [threadId, authorId, maskSecrets(text), JSON.stringify(actions)]);
  const t = (await pool.query("update threads set turns=turns+1, updated_at=now() where id=$1 returning turns", [threadId])).rows[0];
  await pool.query(`update thread_participants set last_read_message_id=(select max(id) from messages where thread_id=$1)
    where thread_id=$1 and member_id=$2`, [threadId, authorId]);
  if (t.turns >= cfg.maxTurns) {
    await pool.query("update threads set status='needs_human' where id=$1", [threadId]);
    return { status: "needs_human", turns: t.turns as number };
  }
  await pool.query("update threads set status='waiting' where id=$1", [threadId]);
  const other = (await pool.query("select member_id from thread_participants where thread_id=$1 and member_id<>$2", [threadId, authorId])).rows[0]?.member_id;
  if (other) await sink(threadId, other);
  return { status: "waiting", turns: t.turns as number };
}

export async function ask(pool: Pool, cfg: Config, sink: JobSink, from: Member,
  a: { to?: string; project?: string; subject: string; text: string }, online: Set<number>) {
  if (!a.to && !a.project) throw new HubError("no_recipient", "Укажите адресата или проект");
  let projectId: number | null = null;
  let recipient: number;
  if (a.project) {
    const o = await projectOwners(pool, a.project);
    projectId = o.projectId;
    if (a.to) {
      const m = await findMember(pool, a.to);
      if (m.id === from.id) throw new HubError("self_ask", "Нельзя спросить самого себя");
      if (!o.ownerIds.includes(m.id)) throw new HubError("not_owner", `${m.shortName} не владелец проекта ${a.project}`);
      recipient = m.id;
    } else {
      const others = o.ownerIds.filter((id) => id !== from.id);
      if (!others.length) throw new HubError("no_owners", `У проекта «${a.project}» нет владельцев, кроме вас`);
      recipient = await pickOwner(pool, others, online);
    }
  } else {
    const m = await findMember(pool, a.to!);
    if (m.id === from.id) throw new HubError("self_ask", "Нельзя спросить самого себя");
    recipient = m.id;
  }
  const t = (await pool.query("insert into threads(subject,project_id,created_by) values($1,$2,$3) returning id",
    [a.subject.trim(), projectId, from.id])).rows[0];
  await pool.query("insert into thread_participants(thread_id,member_id) values($1,$2),($1,$3)", [t.id, from.id, recipient]);
  const res = await addMessage(pool, cfg, sink, t.id, from.id, a.text, []);
  const name = (await pool.query("select short_name from members where id=$1", [recipient])).rows[0].short_name;
  return { threadId: t.id as number, recipientShortName: name as string, status: res.status };
}

async function requireParticipant(pool: Pool, member: Member, threadId: number) {
  const t = (await pool.query("select t.*, p.name project from threads t left join projects p on p.id=t.project_id where t.id=$1", [threadId])).rows[0];
  if (!t) throw new HubError("unknown_thread", "Ветка не найдена");
  const p = await pool.query("select 1 from thread_participants where thread_id=$1 and member_id=$2", [threadId, member.id]);
  if (!p.rowCount) throw new HubError("forbidden", "Вы не участник ветки");
  return t;
}

export async function reply(pool: Pool, cfg: Config, sink: JobSink, from: Member, a: { threadId: number; text: string; actions?: Action[] }) {
  const t = await requireParticipant(pool, from, a.threadId);
  if (t.status === "closed") throw new HubError("thread_closed", "Ветка закрыта");
  if (t.status === "needs_human") throw new HubError("needs_human", "Ветка упёрлась в лимит реплик, нужен человек");
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
  const parts = await pool.query(`select m.short_name from thread_participants tp join members m on m.id=tp.member_id
    where tp.thread_id=$1 order by m.id`, [threadId]);
  const msgs = await pool.query(`select ms.*, m.short_name author from messages ms join members m on m.id=ms.author_id
    where thread_id=$1 order by ms.id`, [threadId]);
  const dec = await pool.query("select summary from decisions where thread_id=$1 order by id desc limit 1", [threadId]);
  return {
    id: t.id as number, subject: t.subject as string, project: t.project as string | null, status: t.status as string, turns: t.turns as number,
    participants: parts.rows.map((x) => x.short_name as string),
    messages: msgs.rows.map((x) => ({ id: x.id, author: x.author, text: x.text, actions: x.actions, createdAt: x.created_at })),
    decision: dec.rows[0]?.summary as string | undefined,
  };
}

// Новое для участника; помечает прочитанным
export async function inbox(pool: Pool, member: Member) {
  const rows = (await pool.query(`select t.id, t.subject, t.status,
      (select count(*) from messages m where m.thread_id=t.id and m.id>tp.last_read_message_id and m.author_id<>$1)::int new_messages
    from threads t join thread_participants tp on tp.thread_id=t.id and tp.member_id=$1 order by t.updated_at desc`, [member.id])).rows
    .filter((r) => r.new_messages > 0);
  const key = `inbox_decision_${member.id}`;
  const decs = await pool.query(`select d.id, d.thread_id, d.summary from decisions d
    join thread_participants tp on tp.thread_id=d.thread_id and tp.member_id=$1
    where d.id > coalesce((select value::int from settings where key=$2), 0) order by d.id`, [member.id, key]);
  await pool.query(`update thread_participants tp set last_read_message_id=coalesce((select max(id) from messages where thread_id=tp.thread_id),0)
    where member_id=$1`, [member.id]);
  await pool.query(`insert into settings(key,value) values($1, coalesce((select max(id) from decisions),0)::text)
    on conflict(key) do update set value=excluded.value`, [key]);
  return {
    threads: rows.map((r) => ({ id: r.id as number, subject: r.subject as string, status: r.status as string, newMessages: r.new_messages as number })),
    decisions: decs.rows.map((r) => ({ threadId: r.thread_id as number, summary: r.summary as string })),
  };
}

export async function listDecisions(pool: Pool, a: { project?: string; query?: string; limit?: number }) {
  const r = await pool.query(`select d.id, d.thread_id, p.name project, d.summary, d.links, d.created_at
    from decisions d left join projects p on p.id=d.project_id
    where ($1::text is null or lower(p.name)=lower($1)) and ($2::text is null or d.summary ilike '%'||$2||'%')
    order by d.id desc limit $3`, [a.project ?? null, a.query ?? null, a.limit ?? 50]);
  return r.rows.map((x) => ({ id: x.id, threadId: x.thread_id, project: x.project, summary: x.summary, links: x.links, createdAt: x.created_at }));
}

// Сводка для хука при старте сессии; ничего не помечает прочитанным
export async function digest(pool: Pool, member: Member, sinceIso?: string) {
  const since = sinceIso ?? new Date(Date.now() - 7 * 864e5).toISOString();
  const byStatus = (status: string) => pool.query(`select t.id, t.subject, t.status, p.name project from threads t
    join thread_participants tp on tp.thread_id=t.id and tp.member_id=$1 left join projects p on p.id=t.project_id
    where t.status=$2 and t.updated_at >= $3 order by t.updated_at desc`, [member.id, status, since]);
  const decisions = await pool.query(`select d.thread_id, d.summary, p.name project, d.created_at from decisions d
    join thread_participants tp on tp.thread_id=d.thread_id and tp.member_id=$1 left join projects p on p.id=d.project_id
    where d.created_at >= $2 order by d.id desc`, [member.id, since]);
  return { decisions: decisions.rows, needsHuman: (await byStatus("needs_human")).rows, open: (await byStatus("waiting")).rows };
}
