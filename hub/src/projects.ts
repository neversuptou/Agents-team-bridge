import type { Pool } from "./db.js";
import { HubError } from "./members.js";
export type ProjectInput = { name: string; gitRemote?: string; localPath?: string };
export type MyProject = { name: string; gitRemote: string | null; localPath: string | null };
export type DirectoryEntry = { fullName: string; shortName: string; online: boolean; projects: string[] };

// Проект ищется по имени без учёта регистра; нет — создаётся
async function ensureProject(pool: Pool, p: ProjectInput): Promise<number> {
  const name = p.name.trim();
  if (!name) throw new HubError("invalid_project", "Пустое имя проекта");
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
    .map((x) => ({ id: x.id as number, fullName: x.full_name, shortName: x.short_name, online: online.has(x.id), projects: x.projects as string[] }))
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
