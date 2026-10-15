import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const slug = (s = "") => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "task";

// Основная ветка origin: origin/HEAD, иначе origin/main или origin/master
function baseRef(repo: string) {
  try { return git(repo, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"); }
  catch {
    for (const b of ["origin/main", "origin/master"]) {
      try { git(repo, "rev-parse", "--verify", b); return b; } catch { /* следующая */ }
    }
    throw new Error("Не найдена основная ветка origin (origin/HEAD, main, master)");
  }
}

/*
  Где работает ответчик: для проекта — отдельная рабочая копия (git worktree) на ветке agent/<ветка>-<тема>
  от свежего origin, чтобы не трогать рабочую папку человека; без проекта — пустая папка.
*/
export async function prepareWorkspace(a: {
  jobId: number; threadId: number; subject?: string;
  project: { name: string; localPath: string | null } | null; root: string;
}) {
  const cwd = join(a.root, "work", String(a.jobId));
  if (!a.project) {
    mkdirSync(cwd, { recursive: true });
    return { cwd, branch: undefined as string | undefined, cleanup: async () => rmSync(cwd, { recursive: true, force: true }) };
  }
  const repo = a.project.localPath;
  if (!repo || !existsSync(join(repo, ".git"))) {
    throw new Error(`Репозиторий проекта ${a.project.name} не найден по пути ${repo ?? "(не указан)"} — поправьте путь через my_projects`);
  }
  git(repo, "fetch", "origin", "--prune");
  const branch = `agent/${a.threadId}-${slug(a.subject)}`;
  mkdirSync(join(a.root, "work"), { recursive: true });
  rmSync(cwd, { recursive: true, force: true });
  const exists = git(repo, "branch", "--list", branch) !== "";
  git(repo, "worktree", "add", ...(exists ? [cwd, branch] : ["-b", branch, cwd, baseRef(repo)]));
  return {
    cwd, branch,
    cleanup: async () => {
      try { git(repo, "worktree", "remove", "--force", cwd); }
      catch { rmSync(cwd, { recursive: true, force: true }); git(repo, "worktree", "prune"); }
    },
  };
}
