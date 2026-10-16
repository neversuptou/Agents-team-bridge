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

test("окно «Принять запрос?» показывает человеку текст вопроса (Claude его не видел)", async () => {
  const h = human(true);
  const preview = async (id: number) => (id === 3 ? "почему падает тест дат?" : null);
  expect((await confirmOutgoing("respond_request", { thread_id: 3, accept: true }, h.elicit, preview)).ok).toBe(true);
  expect(h.shown[0]).toContain("почему падает тест дат?");
});

test("текст в окне показывается целиком, без обрезки", async () => {
  const h = human(true);
  const long = "начало " + "я".repeat(9000) + " КОНЕЦ";
  await confirmOutgoing("reply", { thread_id: 1, text: long, about_evapps: true }, h.elicit);
  expect(h.shown[0]).toContain("КОНЕЦ");
  expect(h.shown[0]).not.toContain("обрезано");
});

test("вопрос не про Evapps — тоже отдельное согласие", async () => {
  const h = human(true, false);
  expect((await confirmOutgoing("ask", { project: "fin", subject: "s", text: "личное", about_evapps: false }, h.elicit)).ok).toBe(false);
  expect(h.shown[1]).toContain("Отдельное согласие");
  const h2 = human(true);
  expect((await confirmOutgoing("ask", { project: "fin", subject: "s", text: "по fin", about_evapps: true }, h2.elicit)).ok).toBe(true);
});

test("неизвестный и служебный инструменты Claude не вызывает", async () => {
  expect((await confirmOutgoing("exec", {}, human(true).elicit)).ok).toBe(false);
  expect((await confirmOutgoing("request_preview", { thread_id: 3 }, human(true).elicit)).ok).toBe(false);
});
