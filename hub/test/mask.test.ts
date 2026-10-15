import { test, expect } from "vitest";
import { maskSecrets } from "../src/mask.js";
test.each([
  ["токен glpat-AbCdEf1234567890xyz12 тут", "glpat"],
  ["ключ sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA конец", "sk"],
  ["password=Qwerty123!", "password"],
  ["PGPASSWORD: hunter2hunter2", "PGPASSWORD"],
  ["Authorization: Bearer abcdefghijklmnopqrstuv", "Bearer"],
  ["-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----", "PRIVATE KEY"],
])("маскирует %s", (input, marker) => {
  const out = maskSecrets(input);
  expect(out).toContain("[скрыто]"); expect(out).toContain(marker);
  expect(out).not.toMatch(/AbCdEf1234567890|AAAAAAAAAAAA|Qwerty123|hunter2hunter2|abcdefghijklmnopqrstuv|\nabc\n/);
});
test("обычный текст не трогает", () => { expect(maskSecrets("password в коде — плохо")).toBe("password в коде — плохо"); });
