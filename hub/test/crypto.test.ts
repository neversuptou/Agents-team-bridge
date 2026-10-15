import { test, expect } from "vitest";
import { newToken, hashSecret, safeEqual } from "../src/crypto.js";
test("токен уникальный и с префиксом", () => {
  const a = newToken(), b = newToken();
  expect(a).toMatch(/^tb_[A-Za-z0-9_-]{43}$/); expect(a).not.toBe(b);
});
test("хэш зависит от соли и стабилен", () => {
  expect(hashSecret("s1", "x")).toBe(hashSecret("s1", "x"));
  expect(hashSecret("s1", "x")).not.toBe(hashSecret("s2", "x"));
});
test("safeEqual", () => { expect(safeEqual("ab", "ab")).toBe(true); expect(safeEqual("ab", "ac")).toBe(false); expect(safeEqual("a", "ab")).toBe(false); });
