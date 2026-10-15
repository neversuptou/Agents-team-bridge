import type { Pool } from "./db.js";
import type { Config } from "./config.js";
import { hashSecret, newToken, safeEqual } from "./crypto.js";
import { withTx } from "./db.js";

// Ошибка предметной области: code — для клиентов и тестов, message — человеку по-русски
export class HubError extends Error { constructor(public code: string, message?: string) { super(message ?? code); } }
export type Member = { id: number; fullName: string; shortName: string; isAdmin: boolean };
const toMember = (r: any): Member => ({ id: r.id, fullName: r.full_name, shortName: r.short_name, isAdmin: r.is_admin });

export async function setInviteCode(pool: Pool, cfg: Config, code: string) {
  await pool.query("insert into settings(key,value) values('invite_code_hash',$1) on conflict(key) do update set value=excluded.value",
    [hashSecret(cfg.salt, code)]);
}

// Регистрация по коду команды; первый зарегистрированный становится админом
export async function register(pool: Pool, cfg: Config, a: { inviteCode: string; fullName: string; shortName: string }) {
  const s = await pool.query("select value from settings where key='invite_code_hash'");
  if (!s.rows[0] || !safeEqual(s.rows[0].value, hashSecret(cfg.salt, a.inviteCode ?? ""))) throw new HubError("invalid_invite", "Неверный код приглашения");
  const fullName = (a.fullName ?? "").trim(), shortName = (a.shortName ?? "").trim();
  if (!fullName || !shortName) throw new HubError("invalid_name", "Нужны полное и короткое имя");
  const token = newToken();
  return withTx(pool, async (c) => {
    await c.query("lock table members in share row exclusive mode");
    const taken = await c.query("select 1 from members where lower(short_name)=lower($1)", [shortName]);
    if (taken.rowCount) throw new HubError("short_name_taken", `Имя «${shortName}» уже занято`);
    const first = (await c.query("select count(*)::int n from members")).rows[0].n === 0;
    const r = await c.query("insert into members(full_name,short_name,token_hash,is_admin) values($1,$2,$3,$4) returning *",
      [fullName, shortName, hashSecret(cfg.salt, token), first]);
    return { member: toMember(r.rows[0]), token };
  });
}

export async function authenticate(pool: Pool, cfg: Config, token: string): Promise<Member | null> {
  if (!token?.startsWith("tb_")) return null;
  const r = await pool.query("update members set last_seen_at=now() where token_hash=$1 and revoked_at is null returning *",
    [hashSecret(cfg.salt, token)]);
  return r.rows[0] ? toMember(r.rows[0]) : null;
}

export async function revoke(pool: Pool, adminId: number, memberId: number) {
  const a = await pool.query("select is_admin from members where id=$1 and revoked_at is null", [adminId]);
  if (!a.rows[0]?.is_admin) throw new HubError("forbidden", "Только админ");
  await pool.query("update members set revoked_at=now() where id=$1", [memberId]);
}
