import { beforeAll, describe, expect, it } from "vitest";
import { testDb, resetDb } from "../setup/db";
import { assertDemoSeedAllowed, resolveSeedScope, seedFoundation } from "../../prisma/seed-foundation";
import { BootstrapError, bootstrapSuperAdmin, generateBootstrapPassword } from "../../scripts/lib/bootstrap-admin";
import { verifyPassword, passwordSchema } from "@/server/auth/password";

const db = testDb();

describe("foundation seed and Super Admin bootstrap (launch checklist step 2-3)", () => {
  beforeAll(async () => {
    await resetDb(db);
  });

  it("foundation scope seeds reference data and no user accounts; it is idempotent", async () => {
    await seedFoundation(db);
    await seedFoundation(db);
    expect(await db.user.count()).toBe(0);
    expect(await db.role.count()).toBeGreaterThanOrEqual(8);
    expect(await db.permission.count()).toBeGreaterThan(0);
    expect(await db.agreement.count({ where: { isActive: true } })).toBe(12);
    expect(await db.setting.count()).toBeGreaterThan(0);
    expect(await db.skill.count()).toBeGreaterThan(0);
    expect(await db.assessmentResultLabel.count()).toBe(5);
    expect(await db.certificationTemplate.count()).toBe(3);
    expect(await db.verificationRequirement.count()).toBeGreaterThan(0);
    expect(await db.depositPolicy.count({ where: { isDefault: true } })).toBe(1);
  });

  it("bootstraps a SUPER_ADMIN with a verified email, an audit row, and refuses to silently overwrite a password", async () => {
    const password = generateBootstrapPassword();
    expect(passwordSchema.safeParse(password).success).toBe(true);

    const first = await bootstrapSuperAdmin(db, { email: "  Owner@Example.COM ", password });
    expect(first.created).toBe(true);
    expect(first.email).toBe("owner@example.com");

    const user = await db.user.findUniqueOrThrow({ where: { email: "owner@example.com" }, include: { role: true } });
    expect(user.role.key).toBe("SUPER_ADMIN");
    expect(user.status).toBe("ACTIVE");
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(user.mfaEnabled).toBe(false);
    expect(await verifyPassword(user.passwordHash, password)).toBe(true);
    expect(await db.auditLog.count({ where: { action: "USER_CREATED", entityId: user.id } })).toBe(1);

    await expect(bootstrapSuperAdmin(db, { email: "owner@example.com", password: "AnotherPass123" })).rejects.toBeInstanceOf(BootstrapError);
    expect(await verifyPassword((await db.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash, password)).toBe(true);

    const reset = await bootstrapSuperAdmin(db, { email: "owner@example.com", password: "AnotherPass123", resetPassword: true });
    expect(reset).toMatchObject({ created: false, passwordReset: true, userId: user.id });
    expect(await verifyPassword((await db.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash, "AnotherPass123")).toBe(true);
    expect(await db.user.count()).toBe(1);
  });

  it("rejects a weak password and a missing role set", async () => {
    await expect(bootstrapSuperAdmin(db, { email: "x@example.com", password: "short" })).rejects.toThrow();
    await db.rolePermission.deleteMany({});
    await db.user.deleteMany({});
    await db.role.deleteMany({});
    await expect(bootstrapSuperAdmin(db, { email: "x@example.com", password: "LongEnough123" })).rejects.toThrow(/db:seed:foundation/);
  });

  it("demo scope is refused for Supabase hosts and production unless ALLOW_DEMO_SEED=1", () => {
    expect(resolveSeedScope(["--foundation"], {})).toBe("foundation");
    expect(resolveSeedScope([], { SEED_SCOPE: "foundation" })).toBe("foundation");
    expect(resolveSeedScope([], {})).toBe("demo");
    expect(() => assertDemoSeedAllowed({ DATABASE_URL: "postgresql://u:p@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true" })).toThrow(/Refusing/);
    expect(() => assertDemoSeedAllowed({ DATABASE_URL: "postgresql://u:p@db.abc.supabase.co:5432/postgres" })).toThrow(/Refusing/);
    expect(() => assertDemoSeedAllowed({ NODE_ENV: "production", DATABASE_URL: "postgresql://u:p@localhost:5432/x" })).toThrow(/Refusing/);
    expect(() => assertDemoSeedAllowed({ DATABASE_URL: "postgresql://u:p@localhost:5433/hirewise_dev" })).not.toThrow();
    expect(() => assertDemoSeedAllowed({ ALLOW_DEMO_SEED: "1", DATABASE_URL: "postgresql://u:p@db.abc.supabase.co:5432/postgres" })).not.toThrow();
  });
});
