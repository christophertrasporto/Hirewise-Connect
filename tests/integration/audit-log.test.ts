import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { testDb, resetDb } from "../setup/db";
import { audit } from "@/server/audit/audit";
import { makeActor } from "@/server/auth/actor";

const db = testDb();

beforeAll(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("AuditLog is append-only (INV-I3)", () => {
  it("accepts inserts through the audit helper", async () => {
    await audit(db, {
      actor: makeActor("ADMIN", { userId: "admin_1" }),
      action: "PROFILE_APPROVED",
      entityType: "AgentProfile",
      entityId: "agent_1",
      previousValue: { status: "UNDER_REVIEW" },
      newValue: { status: "APPROVED" },
      reason: "Meets requirements",
    });
    const rows = await db.auditLog.findMany({ where: { entityId: "agent_1" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].actorUserId).toBe("admin_1");
    expect(rows[0].actorRole).toBe("ADMIN");
    expect(rows[0].previousValue).toEqual({ status: "UNDER_REVIEW" });
  });

  it("records system actors with a null user id", async () => {
    await audit(db, { actor: makeActor("SUPER_ADMIN", { userId: "system" }), action: "SETTING_CHANGED", entityType: "Setting", entityId: "reservationTtlDays" });
    const row = await db.auditLog.findFirst({ where: { entityId: "reservationTtlDays" } });
    expect(row?.actorUserId).toBeNull();
  });

  it("rejects UPDATE at the database level", async () => {
    await expect(db.$executeRawUnsafe(`UPDATE "AuditLog" SET "reason" = 'tampered'`)).rejects.toThrow(/append-only/i);
    const row = await db.auditLog.findFirst({ where: { entityId: "agent_1" } });
    expect(row?.reason).toBe("Meets requirements");
  });

  it("rejects DELETE at the database level", async () => {
    await expect(db.$executeRawUnsafe(`DELETE FROM "AuditLog"`)).rejects.toThrow(/append-only/i);
    expect(await db.auditLog.count()).toBe(2);
  });

  it("rejects updates through Prisma too", async () => {
    const row = await db.auditLog.findFirstOrThrow();
    await expect(db.auditLog.update({ where: { id: row.id }, data: { reason: "x" } })).rejects.toThrow();
    await expect(db.auditLog.delete({ where: { id: row.id } })).rejects.toThrow();
  });
});
