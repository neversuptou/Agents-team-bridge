import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
export const newToken = (prefix = "tb_") => prefix + randomBytes(32).toString("base64url");
export const hashSecret = (salt: string, value: string) => createHash("sha256").update(salt + value).digest("hex");
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
