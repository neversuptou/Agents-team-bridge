// Маскирование строк, похожих на секреты, перед сохранением сообщений в хабе
type Rule = [RegExp, (...g: string[]) => string];
const RULES: Rule[] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, () => "-----PRIVATE KEY [скрыто]-----"],
  [/\b(glpat|ghp|gho|github_pat|xox[abp])[-_][A-Za-z0-9_-]{10,}/g, (_m, p) => `${p}-[скрыто]`],
  [/\bsk-(ant-)?[A-Za-z0-9_-]{16,}/g, (_m, ant) => `sk-${ant ?? ""}[скрыто]`],
  [/\b(Bearer)\s+[A-Za-z0-9._~+\/-]{16,}=*/g, (_m, p) => `${p} [скрыто]`],
  [/\b([A-Za-z_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_KEY|password|passwd|secret|token|api_key))(\s*[:=]\s*)(["']?)[^\s"']{4,}\3/g,
    (_m, k, sep) => `${k}${sep}[скрыто]`],
];
export function maskSecrets(text: string): string {
  return RULES.reduce((t, [re, fn]) => t.replace(re, fn as (...a: any[]) => string), text);
}
