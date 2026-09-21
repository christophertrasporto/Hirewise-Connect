import { hash, verify, type Options } from "@node-rs/argon2";
import { z } from "zod";

/** Argon2id with OWASP-recommended parameters (Section 12, security baseline). */
// 2 === Algorithm.Argon2id; the enum is a const enum and cannot be referenced under isolatedModules.
const ARGON2: Options = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(128, "Use at most 128 characters.")
  .refine((p) => /[a-z]/.test(p) && /[A-Z0-9]/.test(p), "Mix lower case with upper case or digits.");

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2);
}

export async function verifyPassword(hashed: string | null | undefined, plain: string): Promise<boolean> {
  if (!hashed) {
    // Constant-time-ish: still run a hash so timing does not reveal "no password set".
    await hash(plain, ARGON2);
    return false;
  }
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}
