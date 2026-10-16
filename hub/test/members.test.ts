import { beforeEach, afterEach, test, expect } from "vitest";
import { freshDb, testConfig as cfg, addMember } from "./helpers.js";
import { createInvite, register, authenticate, revoke, bootstrapInvite, listInvites, revokeInvite } from "../src/members.js";
let pool: Awaited<ReturnType<typeof freshDb>>;

test("одновременная регистрация имён, отличающихся регистром, — понятная ошибка, а не сбой", async () => {
  const a = await addMember(pool, "а");
  const [i1, i2] = [await createInvite(pool, cfg, a.member.id, { fullName: "Б" }), await createInvite(pool, cfg, a.member.id, { fullName: "В" })];
  const res = await Promise.allSettled([register(pool, cfg, { invite: i1.invite, shortName: "Дима" }), register(pool, cfg, { invite: i2.invite, shortName: "дима" })]);
  expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect((res.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "short_name_taken" });
});

test("админ видит приглашения и может отозвать неиспользованное", async () => {
  const a = await addMember(pool, "а");
  const { invite, id } = await createInvite(pool, cfg, a.member.id, { fullName: "Пётр" });
  expect((await listInvites(pool)).map((x) => [x.id, x.fullName, x.state])).toContainEqual([id, "Пётр", "active"]);
  await expect(revokeInvite(pool, { ...a.member, isAdmin: false }, id)).rejects.toMatchObject({ code: "forbidden" });
  await revokeInvite(pool, a.member, id);
  expect((await listInvites(pool)).find((x) => x.id === id)?.state).toBe("revoked");
  await expect(register(pool, cfg, { invite, shortName: "п" })).rejects.toMatchObject({ code: "invalid_invite" });
});
beforeEach(async () => { pool = await freshDb(); });
afterEach(async () => { await pool.end(); });

test("стартовое приглашение — только пока нет участников, делает админом", async () => {
  const a = await addMember(pool, "Данила");
  expect(a.member.isAdmin).toBe(true);
  expect(await bootstrapInvite(pool, cfg)).toBeNull();
});

test("приглашение именное и одноразовое; полное имя задаёт админ", async () => {
  const a = await addMember(pool, "Данила");
  const { invite } = await createInvite(pool, cfg, a.member.id, { fullName: "Дмитрий Волков" });
  expect(invite).toMatch(/^tbi_/);
  const b = await register(pool, cfg, { invite, shortName: "Дима" });
  expect(b.member).toMatchObject({ fullName: "Дмитрий Волков", shortName: "Дима", isAdmin: false });
  expect((await authenticate(pool, cfg, b.token))?.shortName).toBe("Дима");
  await expect(register(pool, cfg, { invite, shortName: "Другой" })).rejects.toMatchObject({ code: "invalid_invite" });
});

test("просроченное и чужое приглашение не принимается", async () => {
  const a = await addMember(pool, "Данила");
  const { invite } = await createInvite(pool, cfg, a.member.id, { fullName: "Б", ttlHours: -1 });
  await expect(register(pool, cfg, { invite, shortName: "б" })).rejects.toMatchObject({ code: "invalid_invite" });
  await expect(register(pool, cfg, { invite: "tbi_nope", shortName: "б" })).rejects.toMatchObject({ code: "invalid_invite" });
});

test("приглашать может только админ", async () => {
  const a = await addMember(pool, "а");
  const b = await addMember(pool, "б", a.member);
  await expect(createInvite(pool, cfg, b.member.id, { fullName: "В" })).rejects.toMatchObject({ code: "forbidden" });
});

test("занятое короткое имя (без учёта регистра)", async () => {
  const a = await addMember(pool, "Дима");
  const { invite } = await createInvite(pool, cfg, a.member.id, { fullName: "Б" });
  await expect(register(pool, cfg, { invite, shortName: "дима" })).rejects.toMatchObject({ code: "short_name_taken" });
});

test("токен и приглашение хранятся только хэшем", async () => {
  const a = await addMember(pool, "а");
  const { invite } = await createInvite(pool, cfg, a.member.id, { fullName: "Б" });
  expect(JSON.stringify((await pool.query("select * from members")).rows)).not.toContain(a.token);
  expect(JSON.stringify((await pool.query("select * from invites")).rows)).not.toContain(invite);
});

test("отзыв: админ — любого кроме себя, участник — только себя", async () => {
  const a = await addMember(pool, "а");
  const b = await addMember(pool, "б", a.member);
  const c = await addMember(pool, "в", a.member);
  await expect(revoke(pool, b.member, c.member.id)).rejects.toMatchObject({ code: "forbidden" });
  await expect(revoke(pool, a.member, a.member.id)).rejects.toMatchObject({ code: "forbidden" });
  await expect(revoke(pool, a.member, NaN)).rejects.toMatchObject({ code: "unknown_member" });
  await revoke(pool, a.member, b.member.id);
  await revoke(pool, c.member, c.member.id);
  expect(await authenticate(pool, cfg, b.token)).toBeNull();
  expect(await authenticate(pool, cfg, c.token)).toBeNull();
});

test("журнал аудита только на добавление", async () => {
  await addMember(pool, "а");
  const n = (await pool.query("select count(*)::int n from audit_log")).rows[0].n;
  expect(n).toBeGreaterThan(0);
  await expect(pool.query("delete from audit_log")).rejects.toThrow(/только добавление/);
  await expect(pool.query("update audit_log set action='x'")).rejects.toThrow(/только добавление/);
});
