import type { Pool } from "./db.js";
import { HubError, requireAdmin, type Member } from "./members.js";
import { audit } from "./audit.js";
import { sanitize } from "./guard.js";
export type ProjectInput = { name: string; gitRemote?: string; localPath?: string };
export type MyProject = { name: string; gitRemote: string | null; localPath: string | null; approved: boolean };
export type DirectoryEntry = { fullName: string; shortName: string; projects: string[] };

// Проект — это канал. Ищется по имени без учёта регистра; нет — создаётся
async function ensureProject(pool: Pool, p: ProjectInput): Promise<number> {
  const name = sanitize(p.name ?? "").trim();
  if (!name || name.length > 80) throw new HubError("invalid_project", "Имя проекта — от 1 до 80 символов");
  const found = await pool.query("select id from projects where lower(name)=lower($1)", [name]);
  if (found.rows[0]) {
    if (p.gitRemote) await pool.query("update projects set git_remote=coalesce(git_remote,$2), is_evapps=is_evapps or $3 where id=$1",
      [found.rows[0].id, p.gitRemote, isOrgRemote(p.gitRemote)]);
    return found.rows[0].id;
  }
  return (await pool.query("insert into projects(name,git_remote,is_evapps) values($1,$2,$3) returning id",
    [name, p.gitRemote ?? null, isOrgRemote(p.gitRemote)])).rows[0].id;
}

// Проект Evapps — репозиторий на домене компании или его поддоменах (TB_ORG_DOMAINS, по умолчанию evapps.ru)
const ORG_DOMAINS = (process.env.TB_ORG_DOMAINS ?? "evapps.ru").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
export function isOrgRemote(remote?: string | null) {
  const m = remote?.trim().toLowerCase().match(/^(?:[a-z+]+:\/\/)?(?:[^@\/]+@)?([^:\/]+)[:\/]/);
  return !!m && ORG_DOMAINS.some((d) => m[1] === d || m[1].endsWith("." + d));
}

// Пометить проект как проект Evapps вручную (например, без git) — только админ
export async function markEvapps(pool: Pool, admin: Member, project: string, value = true) {
  await requireAdmin(pool, admin.id);
  const r = await pool.query("update projects set is_evapps=$2 where lower(name)=lower($1)", [project, value]);
  if (!r.rowCount) throw new HubError("unknown_project", `Проект «${project}» не найден`);
  await audit(pool, admin.id, "project.mark_evapps", project, { value });
}

// Свои проекты: доступ к каналу участнику подтверждает админ, проекты админа подтверждены сразу
export async function setMyProjects(pool: Pool, me: Member, a: { add?: ProjectInput[]; remove?: string[] }) {
  for (const p of a.add ?? []) {
    const pid = await ensureProject(pool, p);
    await pool.query(`insert into member_projects(member_id,project_id,local_path,approved) values($1,$2,$3,$4)
      on conflict(member_id,project_id) do update set local_path=coalesce(excluded.local_path, member_projects.local_path)`,
      [me.id, pid, p.localPath ?? null, me.isAdmin]);
    await audit(pool, me.id, "project.join", `project:${pid}`, { approved: me.isAdmin });
  }
  for (const name of a.remove ?? [])
    await pool.query("delete from member_projects where member_id=$1 and project_id in (select id from projects where lower(name)=lower($2))", [me.id, name]);
  return myProjects(pool, me.id);
}

export async function myProjects(pool: Pool, memberId: number): Promise<MyProject[]> {
  const r = await pool.query(`select p.name, p.git_remote, mp.local_path, mp.approved from member_projects mp join projects p on p.id=mp.project_id
    where mp.member_id=$1 order by p.name`, [memberId]);
  return r.rows.map((x) => ({ name: x.name, gitRemote: x.git_remote, localPath: x.local_path, approved: x.approved }));
}

export async function pendingMemberships(pool: Pool) {
  const r = await pool.query(`select m.id, m.short_name, p.name from member_projects mp join members m on m.id=mp.member_id
    join projects p on p.id=mp.project_id where not mp.approved and m.revoked_at is null order by m.id, p.name`);
  return r.rows.map((x) => ({ memberId: x.id as number, shortName: x.short_name as string, project: x.name as string }));
}

export async function approveMembership(pool: Pool, admin: Member, memberId: number, project: string, approve = true) {
  await requireAdmin(pool, admin.id);
  const q = approve
    ? "update member_projects set approved=true where member_id=$1 and project_id=(select id from projects where lower(name)=lower($2))"
    : "delete from member_projects where member_id=$1 and project_id=(select id from projects where lower(name)=lower($2))";
  const r = await pool.query(q, [memberId, project]);
  if (!r.rowCount) throw new HubError("unknown_project", "Нет такой заявки");
  await audit(pool, admin.id, approve ? "project.approve" : "project.deny", `member:${memberId}`, { project });
}

export async function directory(pool: Pool, query?: string): Promise<DirectoryEntry[]> {
  const r = await pool.query(`select m.full_name, m.short_name,
      coalesce(array_agg(p.name order by p.name) filter (where p.id is not null), '{}') projects
    from members m left join member_projects mp on mp.member_id=m.id and mp.approved left join projects p on p.id=mp.project_id
    where m.revoked_at is null group by m.id order by m.full_name`);
  const q = query?.trim().toLowerCase();
  return r.rows
    .map((x) => ({ fullName: x.full_name as string, shortName: x.short_name as string, projects: x.projects as string[] }))
    .filter((e) => !q || [e.fullName, e.shortName, ...e.projects].some((s) => s.toLowerCase().includes(q)));
}

export async function projectOwners(pool: Pool, name: string) {
  const p = await pool.query("select id, name, is_evapps from projects where lower(name)=lower($1)", [name.trim()]);
  if (!p.rows[0]) throw new HubError("unknown_project", `Проект «${name}» не найден в справочнике`);
  const o = await pool.query(`select mp.member_id from member_projects mp join members m on m.id=mp.member_id
    where mp.project_id=$1 and mp.approved and m.revoked_at is null order by mp.member_id`, [p.rows[0].id]);
  return { projectId: p.rows[0].id as number, name: p.rows[0].name as string, isEvapps: p.rows[0].is_evapps as boolean,
    ownerIds: o.rows.map((x) => x.member_id as number) };
}

// Писать напрямую можно тем, с кем есть общий подтверждённый проект
export async function sharesProject(pool: Pool, a: number, b: number) {
  const r = await pool.query(`select 1 from member_projects x join member_projects y on y.project_id=x.project_id
    where x.member_id=$1 and y.member_id=$2 and x.approved and y.approved limit 1`, [a, b]);
  return !!r.rowCount;
}
