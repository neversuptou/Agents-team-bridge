import { test, expect } from "vitest";
import { confirmOutgoing } from "../src/gate.js";

// человек отвечает по очереди заданными ответами; запоминаем, что ему показали
const human = (...answers: boolean[]) => {
  const shown: string[] = [];
  const elicit = async (message: string) => { shown.push(message); return answers.shift() ?? false; };
  return { shown, elicit };
};

test("чтение не требует подтверждения", async () => {
  const h = human();
  for (const name of ["whoami", "directory", "inbox", "thread", "requests", "decisions"])
    expect(await confirmOutgoing(name, {}, h.elicit)).toEqual({ ok: true });
  expect(h.shown).toEqual([]);
});

test("ответ по Evapps — одно подтверждение с полным текстом", async () => {
  const h = human(true);
  expect(await confirmOutgoing("reply", { thread_id: 7, text: "в notes.txt три строки", about_evapps: true }, h.elicit)).toEqual({ ok: true });
  expect(h.shown).toHaveLength(1);
  expect(h.shown[0]).toContain("в notes.txt три строки");
  expect(h.shown[0]).toContain("#7");
});

test("не про Evapps (или пометка не указана) — отдельное согласие вторым окном", async () => {
  const h = human(true, true);
  expect(await confirmOutgoing("decide", { thread_id: 1, summary: "итог", about_evapps: false }, h.elicit)).toEqual({ ok: true });
  expect(h.shown).toHaveLength(2);
  expect(h.shown[1]).toContain("Отдельное согласие");
  const h2 = human(true, false);
  expect((await confirmOutgoing("reply", { thread_id: 1, text: "x" }, h2.elicit)).ok).toBe(false);
});

test("отказ человека — ничего не уходит", async () => {
  const h = human(false);
  const r = await confirmOutgoing("ask", { project: "fin", to: "Дима", subject: "s", text: "вопрос" }, h.elicit);
  expect(r.ok).toBe(false);
  expect(h.shown[0]).toContain("Дима");
  expect(h.shown[0]).toContain("вопрос");
});

test("принять/отклонить запрос и заявка на проект — тоже через человека", async () => {
  const h = human(true, false);
  expect((await confirmOutgoing("respond_request", { thread_id: 3, accept: true }, h.elicit)).ok).toBe(true);
  expect(h.shown[0]).toContain("Принять");
  expect((await confirmOutgoing("my_projects", { add: [{ name: "fin" }] }, h.elicit)).ok).toBe(false);
});

test("неизвестный инструмент не пропускается", async () => {
  expect((await confirmOutgoing("exec", {}, human(true).elicit)).ok).toBe(false);
});
