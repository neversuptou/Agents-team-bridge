import { beforeEach, afterEach, test, expect } from "vitest";
import { freshDb, addMember } from "./helpers.js";
import { setMyProjects, myProjects, directory, projectOwners, approveMembership, pendingMemberships, sharesProject, isOrgRemote } from "../src/projects.js";
let pool: any, admin: any, dima: any;
beforeEach(async () => {
  pool = await freshDb();
  admin = (await addMember(pool, "Данила")).member;
  dima = (await addMember(pool, "Дима", admin)).member;
});
afterEach(async () => { await pool.end(); });

test("проект участника ждёт подтверждения админа, у админа — сразу", async () => {
  await setMyProjects(pool, admin, { add: [{ name: "fin", localPath: "D:/fin" }] });
  await setMyProjects(pool, dima, { add: [{ name: "FIN", localPath: "/home/d/fin" }] });
  expect(await myProjects(pool, dima.id)).toEqual([{ name: "fin", gitRemote: null, localPath: "/home/d/fin", approved: false }]);
  expect((await projectOwners(pool, "Fin")).ownerIds).toEqual([admin.id]);
  expect(await sharesProject(pool, admin.id, dima.id)).toBe(false);
  expect(await pendingMemberships(pool)).toEqual([{ memberId: dima.id, shortName: "Дима", project: "fin" }]);
  await expect(approveMembership(pool, dima, dima.id, "fin")).rejects.toMatchObject({ code: "forbidden" });
  await approveMembership(pool, admin, dima.id, "fin");
  expect((await projectOwners(pool, "fin")).ownerIds.sort()).toEqual([admin.id, dima.id].sort());
  expect(await sharesProject(pool, admin.id, dima.id)).toBe(true);
  await setMyProjects(pool, dima, { remove: ["fin"] });
  expect(await myProjects(pool, dima.id)).toEqual([]);
});

test("справочник: поиск по имени и подтверждённому проекту", async () => {
  await setMyProjects(pool, dima, { add: [{ name: "fin" }] });
  expect((await directory(pool, "fin")).map((e) => e.shortName)).toEqual([]);
  await approveMembership(pool, admin, dima.id, "fin");
  expect((await directory(pool, "fin")).map((e) => e.shortName)).toEqual(["Дима"]);
  expect((await directory(pool, "дима"))[0]).toEqual({ fullName: "ДИМА", shortName: "Дима", projects: ["fin"] });
});

test("проект Evapps — репозиторий на домене evapps.ru и его поддоменах, подделки не проходят", () => {
  for (const r of ["https://gitlab.evapps.ru/mvolkov/fin", "git@gitlab.evapps.ru:mvolkov/fin.git", "ssh://git@git.evapps.ru:2222/x/y.git", "https://evapps.ru/x.git"])
    expect(isOrgRemote(r), r).toBe(true);
  for (const r of ["https://github.com/neversuptou/Agents-team-bridge.git", "https://gitlab.evapps.ru.evil.com/x", "https://notevapps.ru/x", "https://evil.com/gitlab.evapps.ru/x", undefined, ""])
    expect(isOrgRemote(r), String(r)).toBe(false);
});

test("неизвестный проект", async () => {
  await expect(projectOwners(pool, "nope")).rejects.toMatchObject({ code: "unknown_project" });
});

test("отозванные не попадают в справочник и во владельцы", async () => {
  await setMyProjects(pool, admin, { add: [{ name: "fin" }] });
  await setMyProjects(pool, dima, { add: [{ name: "fin" }] });
  await approveMembership(pool, admin, dima.id, "fin");
  await pool.query("update members set revoked_at=now() where id=$1", [dima.id]);
  expect((await projectOwners(pool, "fin")).ownerIds).toEqual([admin.id]);
  expect((await directory(pool)).map((e) => e.shortName)).toEqual(["Данила"]);
});
