import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { testDb, resetDb } from "../setup/db";
import { listAgreementsForAdmin, publishAgreementVersion, launchReadiness, listSettings, updateSetting, PLACEHOLDER_MARK } from "@/server/services/launch.service";
import { agreementsFor, missingAgreementsFor, acceptAgreement } from "@/server/services/agreement.service";
import { getSetting } from "@/server/services/setting.service";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError } from "@/server/policies/authorize";
import { ROLE_NAMES, type RoleKey } from "@/server/policies/permissions";
import { resetEnvCache } from "@/server/env";

const db = testDb();
const ids = { owner: "owner_1", admin: "admin_1", sales: "sales_1", clientUser: "" };

beforeAll(async () => {
  process.env.APP_URL = "http://localhost:3000";
  process.env.AUTH_SECRET = "short-secret";
  resetEnvCache();
  await resetDb(db);
  for (const key of Object.keys(ROLE_NAMES) as RoleKey[]) await db.role.create({ data: { key, name: ROLE_NAMES[key].name } });
  const role = async (k: RoleKey) => (await db.role.findUniqueOrThrow({ where: { key: k } })).id;
  await db.user.create({ data: { id: ids.owner, email: "owner@hirewise.example", roleId: await role("SUPER_ADMIN"), mfaEnabled: true } });
  await db.user.create({ data: { id: ids.admin, email: "admin@hirewise.example", roleId: await role("ADMIN") } });
  await db.user.create({ data: { id: ids.sales, email: "sales@hirewise.example", roleId: await role("SALES") } });
  ids.clientUser = (await db.user.create({ data: { email: "c@acme.example", roleId: await role("CLIENT"), emailVerifiedAt: new Date() } })).id;
  await db.client.create({ data: { companyName: "Acme", status: "ACTIVE", contacts: { create: { userId: ids.clientUser, name: "C", businessEmail: "c@acme.example", isPrimary: true } } } });
  await db.agreement.create({ data: { type: "CLIENT_TOS", version: 1, title: "Terms of Service (Client)", bodyMarkdown: `# Terms\n\n> ${PLACEHOLDER_MARK} — replace before launch.`, bodyChecksum: "x", effectiveFrom: new Date("2026-01-01"), isActive: true, requiredForRole: "CLIENT" } });
  await db.depositPolicy.create({ data: { name: "One month", type: "ONE_MONTH", isDefault: true } });
});

afterAll(async () => {
  await db.$disconnect();
});

const owner = () => makeActor("SUPER_ADMIN", { userId: ids.owner });
const admin = () => makeActor("ADMIN", { userId: ids.admin });
const sales = () => makeActor("SALES", { userId: ids.sales });
const client = () => makeActor("CLIENT", { userId: ids.clientUser, clientId: "x" });

describe("agreement versioning (Q11)", () => {
  it("lists every type, flags placeholders, and needs agreement.manage", async () => {
    const rows = await listAgreementsForAdmin(db, admin());
    expect(rows).toHaveLength(12);
    const tos = rows.find((r) => r.type === "CLIENT_TOS")!;
    expect(tos.active).toMatchObject({ version: 1, placeholder: true, acceptances: 0 });
    expect(rows.find((r) => r.type === "AGENT_PRIVACY")!.active).toBeNull();
    await expect(listAgreementsForAdmin(db, sales())).rejects.toThrow(ForbiddenError);
  });

  it("publishing a new version deactivates the old one and re-gates users; old acceptances stay attached", async () => {
    // Client accepts v1 first.
    const v1 = (await agreementsFor(db, client()))[0];
    await acceptAgreement(db, client(), v1.id, { ipAddress: "1.1.1.1" });
    expect(await missingAgreementsFor(db, client())).toEqual([]);

    await expect(publishAgreementVersion(db, sales(), { type: "CLIENT_TOS", title: "Terms of Service (Client)", bodyMarkdown: "x".repeat(60), effectiveFrom: "2026-10-01" })).rejects.toThrow(ForbiddenError);
    await expect(publishAgreementVersion(db, admin(), { type: "CLIENT_TOS", title: "Terms", bodyMarkdown: "too short", effectiveFrom: "2026-10-01" })).rejects.toThrow();
    const counsel = "# Terms of Service\n\n## 1. Definitions\n\nIn this agreement, Hirewise means Hirewise Virtual Assistance Services and Client means the company accepting these terms.\n\n## 2. Governing law\n\nThese terms are governed by the laws of the Republic of the Philippines.";
    const r = await publishAgreementVersion(db, admin(), { type: "CLIENT_TOS", title: "Terms of Service (Client)", bodyMarkdown: counsel, effectiveFrom: "2026-10-01", changeNote: "Counsel review" });
    expect(r.version).toBe(2);
    const rows = await db.agreement.findMany({ where: { type: "CLIENT_TOS" }, orderBy: { version: "asc" } });
    expect(rows.map((x) => [x.version, x.isActive])).toEqual([[1, false], [2, true]]);
    // The client must accept again; the v1 acceptance is still on record with its checksum.
    const missing = await missingAgreementsFor(db, client());
    expect(missing.map((m) => m.version)).toEqual([2]);
    expect(await db.agreementAcceptance.count({ where: { userId: ids.clientUser } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "AGREEMENT_VERSION_PUBLISHED" } })).toBe(1);
    const listed = await listAgreementsForAdmin(db, admin());
    expect(listed.find((x) => x.type === "CLIENT_TOS")!.active).toMatchObject({ version: 2, placeholder: false });
    expect(listed.find((x) => x.type === "CLIENT_TOS")!.versions.map((v) => v.acceptances)).toEqual([0, 1]);
  });
});

describe("launch readiness", () => {
  it("fails on placeholders, missing agreements, weak secret, and the fake provider; needs settings.manage", async () => {
    await expect(launchReadiness(db, admin())).rejects.toThrow(ForbiddenError);
    const r = await launchReadiness(db, owner());
    const by = Object.fromEntries(r.checks.map((c) => [c.key, c]));
    expect(by.agreements.status).toBe("fail"); // 11 types have no active version yet
    expect(by.authSecret.status).toBe("fail");
    expect(by.demoAccounts.status).toBe("warn");
    expect(by.mfa.status).toBe("warn"); // admin has no MFA
    expect(by.superAdmin.status).toBe("pass");
    expect(by.retention.status).toBe("warn");
    expect(by.depositPolicy.status).toBe("pass");
    expect(by.worker.status).toBe("pass");
    expect(r.summary.fail).toBeGreaterThanOrEqual(2);
  });

  it("settings are listed with metadata and updated with audit; retention leaves the default warning", async () => {
    await expect(updateSetting(db, admin(), "retentionDays", "365")).rejects.toThrow(ForbiddenError);
    await expect(updateSetting(db, owner(), "retentionDays", "abc")).rejects.toThrow();
    await expect(updateSetting(db, owner(), "matchWeights", "{not json")).rejects.toThrow(/JSON/);
    await updateSetting(db, owner(), "retentionDays", "365", "Counsel confirmed 12 months");
    await updateSetting(db, owner(), "matchWeights", JSON.stringify({ skills: 40 }));
    expect(await getSetting(db, "retentionDays")).toBe(365);
    expect((await getSetting(db, "matchWeights")).skills).toBe(40);
    const rows = await listSettings(db, owner());
    expect(rows.find((x) => x.key === "retentionDays")).toMatchObject({ value: 365, meta: { kind: "number" } });
    expect(await db.auditLog.count({ where: { action: "SETTING_CHANGED", entityId: "retentionDays" } })).toBe(1);
    const r = await launchReadiness(db, owner());
    expect(r.checks.find((c) => c.key === "retention")?.status).toBe("pass");
  });
});
