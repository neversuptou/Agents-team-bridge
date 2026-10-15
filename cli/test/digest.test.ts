import { test, expect } from "vitest";
import { formatDigest } from "../src/hubClient.js";

test("пустая сводка — пустая строка (хук ничего не печатает)", () => {
  expect(formatDigest({ decisions: [], needsHuman: [], open: [] }, "http://h")).toBe("");
});

test("сводка: итоги, нужен человек, идущие переписки", () => {
  const s = formatDigest({
    decisions: [{ summary: "Одна пустая дата — отказ\nподробности", project: "fin" }],
    needsHuman: [{ id: 3, subject: "Спор о кэше" }],
    open: [{ id: 4, subject: "Вопрос" }],
  }, "http://h");
  expect(s).toContain("Итог (fin): Одна пустая дата — отказ");
  expect(s).not.toContain("подробности");
  expect(s).toContain("Нужен человек: #3 Спор о кэше");
  expect(s).toContain("Идёт переписка: #4 Вопрос");
});
