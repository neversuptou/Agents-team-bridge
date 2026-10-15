import { beforeEach, afterEach, test, expect } from "vitest";
import { freshDb, testConfig as cfg } from "./helpers.js";
import { setInviteCode, register, authenticate, revoke } from "../src/members.js";
let pool: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => { pool = await freshDb(); await setInviteCode(pool, cfg, "team-code"); });
afterEach(async () => { await pool.end(); });

test("первый — админ, второй — нет; токен работает", async () => {
  const a = await register(pool, cfg, { inviteCode: "team-code", fullName: "Дмитрий Середа", shortName: "Дмитрий" });
  const b = await register(pool, cfg, { inviteCode: "team-code", fullName: "Дмитрий Волков", shortName: "Дима" });
  expect(a.member.isAdmin).toBe(true); expect(b.member.isAdmin).toBe(false);
  expect((await authenticate(pool, cfg, b.token))?.shortName).toBe("Дима");
});
test("неверный код приглашения", async () => {
  await expect(register(pool, cfg, { inviteCode: "x", fullName: "А", shortName: "а" })).rejects.toMatchObject({ code: "invalid_invite" });
});
test("занятое короткое имя (без учёта регистра)", async () => {
  await register(pool, cfg, { inviteCode: "team-code", fullName: "А", shortName: "Дима" });
  await expect(register(pool, cfg, { inviteCode: "team-code", fullName: "Б", shortName: "дима" })).rejects.toMatchObject({ code: "short_name_taken" });
});
test("пустое имя", async () => {
  await expect(register(pool, cfg, { inviteCode: "team-code", fullName: " ", shortName: "а" })).rejects.toMatchObject({ code: "invalid_name" });
});
test("токен хранится только хэшем", async () => {
  const { token } = await register(pool, cfg, { inviteCode: "team-code", fullName: "А", shortName: "а" });
  const r = await pool.query("select token_hash from members"); expect(r.rows[0].token_hash).not.toContain(token);
});
test("отзыв токена: только админ, после — authenticate = null", async () => {
  const a = await register(pool, cfg, { inviteCode: "team-code", fullName: "А", shortName: "а" });
  const b = await register(pool, cfg, { inviteCode: "team-code", fullName: "Б", shortName: "б" });
  await expect(revoke(pool, b.member.id, a.member.id)).rejects.toMatchObject({ code: "forbidden" });
  await revoke(pool, a.member.id, b.member.id);
  expect(await authenticate(pool, cfg, b.token)).toBeNull();
});
test("неизвестный токен", async () => { expect(await authenticate(pool, cfg, "tb_nope")).toBeNull(); });
