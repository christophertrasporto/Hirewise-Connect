import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { testDb, resetDb } from "../setup/db";
import { publishEvent } from "@/server/events/outbox";
import { runWorkerOnce } from "@/server/jobs/worker";
import { ConsoleEmailChannel, setEmailChannelForTests } from "@/server/adapters/email";
import { setSetting, getSetting } from "@/server/services/setting.service";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError } from "@/server/policies/authorize";

const db = testDb();
const email = new ConsoleEmailChannel();

beforeAll(async () => {
  await resetDb(db);
  setEmailChannelForTests(email);
  const role = await db.role.create({ data: { key: "AGENT", name: "Agent" } });
  await db.user.create({ data: { id: "user_1", email: "agent@example.com", roleId: role.id } });
});

afterAll(async () => {
  setEmailChannelForTests(null);
  await db.$disconnect();
});

describe("outbox → notification → email job", () => {
  it("processes an event into an in-app notification and an email job, then sends it", async () => {
    await db.$transaction(async (tx) => {
      await publishEvent(tx, "USER_CREATED", { userId: "user_1", role: "AGENT", email: "agent@example.com" });
    });

    const first = await runWorkerOnce(db);
    expect(first.events).toBe(1);
    expect(first.failures).toBe(0);

    const notifications = await db.notification.findMany({ where: { userId: "user_1" } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].type).toBe("WELCOME");

    // The email job was enqueued by the event handler and picked up in the same pass or the next.
    let sent = email.sent.length;
    if (sent === 0) {
      await runWorkerOnce(db);
      sent = email.sent.length;
    }
    expect(sent).toBe(1);
    expect(email.sent[0].to).toBe("agent@example.com");

    const job = await db.job.findFirstOrThrow({ where: { type: "SEND_EMAIL" } });
    expect(job.status).toBe("COMPLETED");

    const refreshed = await db.notification.findFirstOrThrow({ where: { userId: "user_1" } });
    expect(refreshed.channelStatus).toMatchObject({ email: { sentAt: expect.any(String) } });
  });

  it("is idempotent on retry: re-running the same event does not duplicate the notification", async () => {
    await db.$transaction(async (tx) => {
      await publishEvent(tx, "USER_CREATED", { userId: "user_1", role: "AGENT", email: "agent@example.com" });
    });
    await runWorkerOnce(db);
    expect(await db.notification.count({ where: { userId: "user_1", type: "WELCOME" } })).toBe(1);
  });

  it("marks unknown event types failed without crashing the pass", async () => {
    await db.outboxEvent.create({ data: { type: "NOT_A_REAL_EVENT", payload: {} } });
    const r = await runWorkerOnce(db);
    expect(r.failures).toBe(1);
    const ev = await db.outboxEvent.findFirstOrThrow({ where: { type: "NOT_A_REAL_EVENT" } });
    expect(ev.attempts).toBe(1);
    expect(ev.processedAt).toBeNull();
  });
});

describe("settings service: authorize + audit + outbox in one transaction", () => {
  it("rejects actors without settings.manage", async () => {
    await expect(setSetting(db, makeActor("ADMIN"), "reservationTtlDays", 10)).rejects.toThrow(ForbiddenError);
  });

  it("writes the setting, an audit row, and an outbox event together", async () => {
    const actor = makeActor("SUPER_ADMIN", { userId: "system" });
    await setSetting(db, actor, "reservationTtlDays", 10, "Sales asked for longer holds");
    expect(await getSetting(db, "reservationTtlDays")).toBe(10);
    const a = await db.auditLog.findFirst({ where: { entityType: "Setting", entityId: "reservationTtlDays" } });
    expect(a?.newValue).toBe(10);
    expect(a?.reason).toBe("Sales asked for longer holds");
    const ev = await db.outboxEvent.findFirst({ where: { type: "SETTING_CHANGED" } });
    expect(ev).not.toBeNull();
  });

  it("returns the Section 14 default when a setting is unset", async () => {
    expect(await getSetting(db, "hoursPerMonthDefault")).toBe(173);
    expect(await getSetting(db, "marketplaceAccess")).toBe("GATED");
  });
});
