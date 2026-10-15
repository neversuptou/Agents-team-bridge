import { beforeEach, afterEach, test, expect } from "vitest";
import { freshDb, testConfig as cfg } from "./helpers.js";
import { setInviteCode, register } from "../src/members.js";
import { setMyProjects, myProjects, directory, projectOwners } from "../src/projects.js";
let pool: any, me: any, dima: any;
beforeEach(async () => {
  pool = await freshDb(); await setInviteCode(pool, cfg, "c");
  me = (await register(pool, cfg, { inviteCode: "c", fullName: "Дмитрий Середа", shortName: "Дмитрий" })).member;
  dima = (await register(pool, cfg, { inviteCode: "c", fullName: "Дмитрий Волков", shortName: "Дима" })).member;
});
afterEach(async () => { await pool.end(); });
test("добавить и убрать проекты; имя без учёта регистра", async () => {
  await setMyProjects(pool, me.id, { add: [{ name: "fin", gitRemote: "git@git.evapps.ru:mvolkov/fin.git", localPath: "D:/fin" }] });
  await setMyProjects(pool, dima.id, { add: [{ name: "FIN", localPath: "/home/d/fin" }] });
  expect((await projectOwners(pool, "Fin")).ownerIds.sort()).toEqual([me.id, dima.id].sort());
  expect(await myProjects(pool, me.id)).toEqual([{ name: "fin", gitRemote: "git@git.evapps.ru:mvolkov/fin.git", localPath: "D:/fin" }]);
  await setMyProjects(pool, me.id, { remove: ["fin"] });
  expect(await myProjects(pool, me.id)).toEqual([]);
});
test("directory: поиск по имени и проекту, онлайн", async () => {
  await setMyProjects(pool, dima.id, { add: [{ name: "fin" }] });
  const all = await directory(pool, new Set([dima.id]));
  expect(all.find((e) => e.shortName === "Дима")).toMatchObject({ online: true, projects: ["fin"] });
  expect((await directory(pool, new Set(), "волков")).map((e) => e.shortName)).toEqual(["Дима"]);
  expect((await directory(pool, new Set(), "fin")).map((e) => e.shortName)).toEqual(["Дима"]);
});
test("неизвестный проект", async () => {
  await expect(projectOwners(pool, "nope")).rejects.toMatchObject({ code: "unknown_project" });
});
test("отозванные не попадают в справочник и во владельцы", async () => {
  await setMyProjects(pool, dima.id, { add: [{ name: "fin" }] });
  await pool.query("update members set revoked_at=now() where id=$1", [dima.id]);
  expect((await projectOwners(pool, "fin")).ownerIds).toEqual([]);
  expect((await directory(pool, new Set())).map((e) => e.shortName)).toEqual(["Дмитрий"]);
});
