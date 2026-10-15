// Разрешения для `claude -p` ответчика (--settings). В неинтерактивном режиме всё, что не разрешено, отклоняется;
// запреты дублируют опасное явно, чтобы их не перекрыли общие настройки пользователя.
export function permissionSettings() {
  return {
    permissions: {
      allow: [
        "Read", "Edit", "Write", "Glob", "Grep", "mcp__teambridge",
        "Bash(git status:*)", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git show:*)", "Bash(git add:*)", "Bash(git commit:*)",
        "Bash(git checkout -b agent/*)", "Bash(git push origin agent/*)", "Bash(git push -u origin agent/*)",
        "Bash(glab mr create:*)", "Bash(npm test:*)", "Bash(npm run:*)", "Bash(ls:*)",
      ],
      deny: [
        "Bash(git push origin main:*)", "Bash(git push origin master:*)", "Bash(git push origin dev:*)",
        "Bash(git push --force:*)", "Bash(git push -f:*)", "Bash(git merge:*)", "Bash(git rebase:*)", "Bash(git reset --hard:*)",
        "Bash(rm -rf:*)", "Bash(ssh:*)", "Bash(scp:*)", "Bash(docker:*)",
        "Read(**/.env*)", "Read(**/*.pem)", "Read(**/id_*)", "Read(**/credentials*)", "Edit(**/.env*)",
      ],
    },
  };
}
