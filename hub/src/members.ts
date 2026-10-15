import type { Pool } from "./db.js";
import type { Config } from "./config.js";
import { hashSecret, newToken } from "./crypto.js";
import { withTx } from "./db.js";
import { audit } from "./audit.js";
import { sanitize } from "./guard.js";

// Ошибка предметной области: code — для клиентов и тестов, message — человеку по-русски
export class HubError extends Error { constructor(public code: string, message?: string) { super(message ?? code); } }
export type Member = { id: number; fullName: string; shortName: string; isAdmin: boolean };
const toMember = (r: any): Member => ({ id: r.id, fullName: r.full_name, shortName: r.short_name, isAdmin: r.is_admin });

async function insertInvite(pool: Pool, cfg: Config, a: { fullName: string; isAdmin: boolean; createdBy: number | null; ttlHours?: number }) {
  const invite = newToken("tbi_");
  const r = await pool.query(`insert into invites(token_hash,full_name,is_admin,created_by,expires_at)
    values($1,$2,$3,$4, now() + make_interval(hours => $5)) returning id, expires_at`,
    [hashSecret(cfg.salt, invite), a.fullName, a.isAdmin, a.createdBy, a.ttlHours ?? cfg.inviteTtlHours]);
  await audit(pool, a.createdBy, "invite.create", `invite:${r.rows[0].id}`, { fullName: a.fullName, isAdmin: a.isAdmin });
  return { invite, expiresAt: r.rows[0].expires_at as Date };
}

// Стартовое приглашение первого админа — только пока в хабе нет ни одного участника
export async function bootstrapInvite(pool: Pool, cfg: Config) {
  const n = (await pool.query("select count(*)::int n from members")).rows[0].n;
  if (n > 0) return null;
  return (await insertInvite(pool, cfg, { fullName: "Администратор", isAdmin: true, createdBy: null })).invite;
}

// Одноразовое именное приглашение со сроком; выдаёт только админ
export async function createInvite(pool: Pool, cfg: Config, adminId: number, a: { fullName: string; ttlHours?: number }) {
  await requireAdmin(pool, adminId);
  const fullName = sanitize(a.fullName ?? "").trim();
  if (!fullName) throw new HubError("invalid_name", "Укажите полное имя приглашаемого");
  return insertInvite(pool, cfg, { fullName, isAdmin: false, createdBy: adminId, ttlHours: a.ttlHours });
}

export async function register(pool: Pool, cfg: Config, a: { invite: string; shortName: string; fullName?: string }) {
  const shortName = sanitize(a.shortName ?? "").trim();
  if (!shortName || shortName.length > 40) throw new HubError("invalid_name", "Короткое имя — от 1 до 40 символов");
  const token = newToken();
  return withTx(pool, async (c) => {
    // приглашение гасится в той же транзакции: второй раз им не воспользоваться
    const inv = (await c.query(`select * from invites where token_hash=$1 and used_at is null and expires_at > now() for update`,
      [hashSecret(cfg.salt, a.invite ?? "")])).rows[0];
    if (!inv) throw new HubError("invalid_invite", "Приглашение недействительно: неверное, уже использовано или истекло");
    const taken = await c.query("select 1 from members where lower(short_name)=lower($1)", [shortName]);
    if (taken.rowCount) throw new HubError("short_name_taken", `Имя «${shortName}» уже занято`);
    const fullName = inv.is_admin && a.fullName?.trim() ? sanitize(a.fullName).trim() : inv.full_name;
    const r = await c.query("insert into members(full_name,short_name,token_hash,is_admin) values($1,$2,$3,$4) returning *",
      [fullName, shortName, hashSecret(cfg.salt, token), inv.is_admin]);
    await c.query("update invites set used_at=now(), used_by=$2 where id=$1", [inv.id, r.rows[0].id]);
    await audit(c, r.rows[0].id, "member.register", `member:${r.rows[0].id}`, { invite: inv.id });
    return { member: toMember(r.rows[0]), token };
  });
}

export async function authenticate(pool: Pool, cfg: Config, token: string): Promise<Member | null> {
  if (!token?.startsWith("tb_")) return null;
  const r = await pool.query("update members set last_seen_at=now() where token_hash=$1 and revoked_at is null returning *",
    [hashSecret(cfg.salt, token)]);
  return r.rows[0] ? toMember(r.rows[0]) : null;
}

export async function requireAdmin(pool: Pool, memberId: number) {
  const a = await pool.query("select is_admin from members where id=$1 and revoked_at is null", [memberId]);
  if (!a.rows[0]?.is_admin) throw new HubError("forbidden", "Только админ");
}

// Отзыв токена: участник — свой, админ — чужой (себя админ не отзывает, чтобы хаб не остался без админа)
export async function revoke(pool: Pool, by: Member, memberId: number) {
  if (!Number.isInteger(memberId)) throw new HubError("unknown_member", "Нет такого участника");
  if (memberId === by.id ? by.isAdmin : !by.isAdmin) throw new HubError("forbidden", by.isAdmin ? "Админ не может отозвать сам себя" : "Только админ");
  if (by.isAdmin) await requireAdmin(pool, by.id);
  const r = await pool.query("update members set revoked_at=now() where id=$1 and revoked_at is null", [memberId]);
  if (!r.rowCount) throw new HubError("unknown_member", "Нет такого участника");
  await audit(pool, by.id, "member.revoke", `member:${memberId}`);
}
