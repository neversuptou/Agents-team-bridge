import { test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { permissionSettings } from "../src/permissions.js";
import { responderPrompt } from "../src/prompt.js";
import { prepareWorkspace } from "../src/workspace.js";

test("запреты и разрешения на месте", () => {
  const { permissions: p } = permissionSettings() as any;
  for (const d of ["Bash(git push origin main:*)", "Bash(git push origin master:*)", "Bash(git push origin dev:*)", "Bash(git push --force:*)",
    "Bash(git push -f:*)", "Bash(git merge:*)", "Bash(rm -rf:*)", "Bash(ssh:*)", "Bash(docker:*)",
    "Read(**/.env*)", "Read(**/*.pem)", "Read(**/id_*)", "Read(**/credentials*)"]) expect(p.deny).toContain(d);
  expect(p.allow).toEqual(expect.arrayContaining(["mcp__teambridge", "Bash(git commit:*)", "Bash(git push origin agent/:*)", "Edit", "Read"]));
  expect(p.allow.some((a: string) => /push origin (main|master|dev)/.test(a))).toBe(false);
});

test("инструкция ответчика называет ветку, проект и запреты", () => {
  const s = responderPrompt({ shortName: "Дима", threadId: 12, project: "fin", hub: "http://h" });
  expect(s).toContain("Дима"); expect(s).toContain("thread_id=12"); expect(s).toContain('project="fin"');
  expect(s).toContain("main/master/dev"); expect(s).toContain("decide");
});

const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "tb-ws-"));
  const origin = join(root, "origin.git");
  git(root, "init", "--bare", "-b", "main", origin);
  const repo = join(root, "repo");
  git(root, "clone", origin, repo);
  git(repo, "config", "user.email", "t@t"); git(repo, "config", "user.name", "t");
  writeFileSync(join(repo, "README.md"), "hi");
  git(repo, "add", "."); git(repo, "commit", "-m", "init"); git(repo, "push", "-u", "origin", "main");
  return { root, repo };
}

test("рабочая копия проекта: своя ветка от origin, уборка", async () => {
  const { root, repo } = sandbox();
  const ws = await prepareWorkspace({ jobId: 7, threadId: 3, subject: "Fix date!", project: { name: "fin", localPath: repo }, root: join(root, "tb") });
  expect(ws.branch).toBe("agent/3-fix-date");
  expect(existsSync(join(ws.cwd, "README.md"))).toBe(true);
  expect(git(ws.cwd, "rev-parse", "--abbrev-ref", "HEAD")).toBe("agent/3-fix-date");
  await ws.cleanup();
  expect(existsSync(ws.cwd)).toBe(false);
  expect(git(repo, "worktree", "list")).not.toContain(ws.cwd.replace(/\\/g, "/"));
  // повторная ветка той же ветки переписки — берётся существующая
  const again = await prepareWorkspace({ jobId: 8, threadId: 3, subject: "Fix date!", project: { name: "fin", localPath: repo }, root: join(root, "tb") });
  expect(again.branch).toBe("agent/3-fix-date");
  await again.cleanup();
});

test("без проекта — пустая папка; нет репозитория — понятная ошибка", async () => {
  const root = mkdtempSync(join(tmpdir(), "tb-ws-"));
  const ws = await prepareWorkspace({ jobId: 1, threadId: 1, project: null, root });
  expect(readdirSync(ws.cwd)).toEqual([]);
  expect(ws.branch).toBeUndefined();
  await ws.cleanup();
  await expect(prepareWorkspace({ jobId: 2, threadId: 1, project: { name: "fin", localPath: join(root, "nope") }, root }))
    .rejects.toThrow(/Репозиторий проекта fin не найден/);
  await expect(prepareWorkspace({ jobId: 3, threadId: 1, project: { name: "fin", localPath: null }, root }))
    .rejects.toThrow(/не указан/);
});
