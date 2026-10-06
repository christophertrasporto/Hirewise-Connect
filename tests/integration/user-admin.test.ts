import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { testDb, resetDb } from "../setup/db";
import { inviteStaffUser, resendStaffInvite, changeUserRole, grantPermissionOverride, revokePermissionOverride, getUserAccess, accessMatrix, permissionGroups, STAFF_ROLES } from "@/server/services/user-admin.service";
import { resetPassword, loginWithPassword } from "@/server/services/auth.service";
import { resolveActor } from "@/server/auth/resolve-actor";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { resetRateLimits } from "@/server/auth/rate-limit";
import { ConsoleEmailChannel, setEmailChannelForTests } from "@/server/adapters/email";
import { runWorkerOnce } from "@/server/jobs/worker";
import { PERMISSIONS, ROLE_NAMES, ROLE_PERMISSIONS, ALL_PERMISSION_KEYS, type RoleKey } from "@/server/policies/permissions";
import { sha256 } from "@/server/auth/crypto";

const db = testDb();
const meta = { ipAddress: "127.0.0.1", userAgent: "vitest" };
const ids = { owner: "owner_ua", owner2: "owner_ua2", admin: "admin_ua", sales: "sales_ua", agentUser: "", agentProfile: "", invited: "" };

beforeAll(async () => {
  process.env.AUTH_SECRET = "test-auth-secret-at-least-16";
  process.env.APP_URL = "http://localhost:3000";
  process.env.DEV_EXPOSE_LINKS = "true";
  setEmailChannelForTests(new ConsoleEmailChannel());
  await resetDb(db);
  for (const key of Object.keys(ROLE_NAMES) as RoleKey[]) await db.role.create({ data: { key, name: ROLE_NAMES[key].name } });
  for (const key of ALL_PERMISSION_KEYS) await db.permission.create({ data: { key, group: PERMISSIONS[key].group, description: PERMISSIONS[key].description } });
  const role = async (k: RoleKey) => (await db.role.findUniqueOrThrow({ where: { key: k } })).id;
  await db.user.create({ data: { id: ids.owner, email: "owner@hirewise.example", roleId: await role("SUPER_ADMIN"), emailVerifiedAt: new Date() } });
  await db.user.create({ data: { id: ids.owner2, email: "owner2@hirewise.example", roleId: await role("SUPER_ADMIN"), emailVerifiedAt: new Date() } });
  await db.user.create({ data: { id: ids.admin, email: "admin@hirewise.example", roleId: await role("ADMIN"), emailVerifiedAt: new Date() } });
  await db.user.create({ data: { id: ids.sales, email: "sales@hirewise.example", roleId: await role("SALES"), emailVerifiedAt: new Date() } });
  const au = await db.user.create({ data: { email: "agent@t.example", roleId: await role("AGENT"), emailVerifiedAt: new Date() } });
  ids.agentUser = au.id;
  ids.agentProfile = (await db.agentProfile.create({ data: { userId: au.id, displayName: "Agent One", headline: "H", primaryRole: "VA", status: "APPROVED", availabilityStatus: "AVAILABLE", timezone: "Asia/Manila" } })).id;
});

afterAll(async () => {
  delete process.env.DEV_EXPOSE_LINKS;
  setEmailChannelForTests(null);
  await db.$disconnect();
});

const owner = () => makeActor("SUPER_ADMIN", { userId: ids.owner });
const admin = () => makeActor("ADMIN", { userId: ids.admin });
const sales = () => makeActor("SALES", { userId: ids.sales });
const agent = () => makeActor("AGENT", { userId: ids.agentUser, agentProfileId: ids.agentProfile });

describe("inviting staff", () => {
  it("admin invites a recruiter: account with no password, verified email, audit row, and a 7-day set-password link that works", async () => {
    const r = await inviteStaffUser(db, admin(), { email: "  New.Recruiter@Hirewise.Example ", role: "RECRUITER", reason: "Starts Monday" });
    ids.invited = r.userId;
    const u = await db.user.findUniqueOrThrow({ where: { id: r.userId }, include: { role: true } });
    expect(u.email).toBe("new.recruiter@hirewise.example");
    expect(u.role.key).toBe("RECRUITER");
    expect(u.passwordHash).toBeNull();
    expect(u.emailVerifiedAt).not.toBeNull();
    expect(await db.auditLog.count({ where: { action: "USER_CREATED", entityId: u.id, actorUserId: ids.admin } })).toBe(1);

    expect(r.devUrl).toMatch(/\/reset-password\//);
    const token = r.devUrl!.split("/reset-password/")[1];
    const row = await db.authToken.findFirstOrThrow({ where: { tokenHash: sha256(token) } });
    expect(row.kind).toBe("PASSWORD_RESET");
    expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(6.9 * 24 * 60 * 60_000);

    const w = await runWorkerOnce(db);
    expect(w.failures).toBe(0);

    await resetPassword(db, { token, password: "Recruit3rPass!" });
    resetRateLimits();
    const login = await loginWithPassword(db, { email: "new.recruiter@hirewise.example", password: "Recruit3rPass!", remember: false, ...meta });
    expect(login).toBeTruthy();
    const actor = await resolveActor(db, u.id);
    expect(actor.role).toBe("RECRUITER");
    expect(actor.permissions.has("agent.review")).toBe(true);
  });

  it("duplicate email is refused; only a Super Admin can invite a Super Admin; sales and agents cannot invite", async () => {
    await expect(inviteStaffUser(db, admin(), { email: "new.recruiter@hirewise.example", role: "SALES" })).rejects.toThrow(/already exists/);
    await expect(inviteStaffUser(db, admin(), { email: "second.owner@hirewise.example", role: "SUPER_ADMIN" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(inviteStaffUser(db, sales(), { email: "x@hirewise.example", role: "SALES" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(inviteStaffUser(db, agent(), { email: "x@hirewise.example", role: "SALES" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(inviteStaffUser(db, admin(), { email: "not-an-email", role: "SALES" })).rejects.toThrow();
    const r = await inviteStaffUser(db, owner(), { email: "second.owner@hirewise.example", role: "SUPER_ADMIN" });
    expect((await db.user.findUniqueOrThrow({ where: { id: r.userId }, include: { role: true } })).role.key).toBe("SUPER_ADMIN");
  });

  it("resend works for staff without a password and is refused for talent", async () => {
    const r = await inviteStaffUser(db, owner(), { email: "ops.new@hirewise.example", role: "OPERATIONS" });
    const again = await resendStaffInvite(db, admin(), r.userId);
    expect(again.devUrl).toMatch(/\/reset-password\//);
    await expect(resendStaffInvite(db, admin(), ids.agentUser)).rejects.toThrow(/Forgot password/);
  });
});

describe("changing roles", () => {
  it("super admin moves sales to operations: sessions revoked, audited, new permissions at next resolve", async () => {
    await db.session.create({ data: { userId: ids.sales, tokenHash: sha256("sales-session"), expiresAt: new Date(Date.now() + 60_000) } });
    await changeUserRole(db, owner(), { userId: ids.sales, role: "OPERATIONS", reason: "Moved to the ops team" });
    expect(await db.session.count({ where: { userId: ids.sales } })).toBe(0);
    const a = await resolveActor(db, ids.sales);
    expect(a.role).toBe("OPERATIONS");
    expect(a.permissions.has("placement.activate")).toBe(true);
    expect(a.permissions.has("client.manage")).toBe(false);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "USER_ROLE_CHANGED", entityId: ids.sales } });
    expect(log.previousValue).toEqual({ role: "SALES" });
    expect(log.newValue).toEqual({ role: "OPERATIONS" });
    expect(log.reason).toBe("Moved to the ops team");
    // back again for later tests
    await changeUserRole(db, owner(), { userId: ids.sales, role: "SALES", reason: "Back to sales" });
  });

  it("admin cannot change roles; nobody changes their own role; talent keeps their role; the last super admin stays", async () => {
    await expect(changeUserRole(db, admin(), { userId: ids.sales, role: "OPERATIONS", reason: "Trying" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(changeUserRole(db, owner(), { userId: ids.owner, role: "ADMIN", reason: "Step down" })).rejects.toThrow(/own role/);
    await expect(changeUserRole(db, owner(), { userId: ids.agentUser, role: "SALES", reason: "Promote" })).rejects.toThrow(/Talent and client/);
    await expect(changeUserRole(db, owner(), { userId: ids.sales, role: "SALES", reason: "" })).rejects.toThrow();
    await expect(changeUserRole(db, owner(), { userId: "nope", role: "SALES", reason: "Missing" })).rejects.toBeInstanceOf(NotFoundError);

    // demote every other super admin, then the last one is protected
    await changeUserRole(db, owner(), { userId: ids.owner2, role: "ADMIN", reason: "Only one owner" });
    const second = await db.user.findUniqueOrThrow({ where: { email: "second.owner@hirewise.example" } });
    await changeUserRole(db, owner(), { userId: second.id, role: "ADMIN", reason: "Only one owner" });
    const other = makeActor("SUPER_ADMIN", { userId: ids.owner2 }); // stale actor, but rbac.manage is what matters here
    await expect(changeUserRole(db, other, { userId: ids.owner, role: "ADMIN", reason: "Remove the last owner" })).rejects.toThrow(/only active Super Admin/);
  });
});

describe("permission overrides", () => {
  it("super admin grants compensation.read to admin until a date; it resolves, re-granting updates, expiry is honoured, revoke removes", async () => {
    const future = new Date(Date.now() + 3 * 24 * 60 * 60_000).toISOString().slice(0, 10);
    await grantPermissionOverride(db, owner(), { userId: ids.admin, permission: "compensation.read", reason: "Covering margin reports", expiresAt: future });
    let a = await resolveActor(db, ids.admin);
    expect(a.permissions.has("compensation.read")).toBe(true);

    await grantPermissionOverride(db, owner(), { userId: ids.admin, permission: "compensation.read", reason: "Extended", expiresAt: "" });
    expect(await db.userPermissionOverride.count({ where: { userId: ids.admin } })).toBe(1);
    const access = await getUserAccess(db, admin(), ids.admin);
    expect(access.overrides).toHaveLength(1);
    expect(access.overrides[0].reason).toBe("Extended");
    expect(access.overrides[0].expiresAt).toBeNull();
    expect(access.effective).toContain("compensation.read");
    expect(access.rolePermissions).not.toContain("compensation.read");
    expect(access.grantable).not.toContain("audit.read"); // admin already has it
    expect(access.grantable).toContain("settings.manage");
    expect(await db.auditLog.count({ where: { action: "PERMISSION_OVERRIDE_GRANTED", entityType: "UserPermissionOverride" } })).toBe(2);

    // an expired grant is ignored when resolving
    const row = await db.userPermissionOverride.findFirstOrThrow({ where: { userId: ids.admin } });
    await db.userPermissionOverride.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    a = await resolveActor(db, ids.admin);
    expect(a.permissions.has("compensation.read")).toBe(false);
    expect((await getUserAccess(db, owner(), ids.admin)).overrides[0].expired).toBe(true);

    await revokePermissionOverride(db, owner(), row.id, "No longer needed");
    expect(await db.userPermissionOverride.count({ where: { userId: ids.admin } })).toBe(0);
    expect(await db.auditLog.count({ where: { action: "PERMISSION_OVERRIDE_REVOKED", entityId: row.id } })).toBe(1);
    await expect(revokePermissionOverride(db, owner(), row.id, "Again")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("validation and authorization: admin cannot grant, talent cannot hold, role-included permissions and past dates are refused", async () => {
    await expect(grantPermissionOverride(db, admin(), { userId: ids.sales, permission: "compensation.read", reason: "Please", expiresAt: "" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(grantPermissionOverride(db, owner(), { userId: ids.agentUser, permission: "agent.read_public", reason: "Nope", expiresAt: "" })).rejects.toThrow(/Talent and client/);
    await expect(grantPermissionOverride(db, owner(), { userId: ids.sales, permission: "client.manage", reason: "Already", expiresAt: "" })).rejects.toThrow(/already includes/);
    await expect(grantPermissionOverride(db, owner(), { userId: ids.sales, permission: "compensation.read", reason: "Past", expiresAt: "2020-01-01" })).rejects.toThrow(/future/);
    await expect(grantPermissionOverride(db, owner(), { userId: ids.sales, permission: "not.a.permission" as never, reason: "Bad", expiresAt: "" })).rejects.toThrow();
    await expect(getUserAccess(db, sales(), ids.admin)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("access matrix", () => {
  it("covers every catalog permission, super admin has all, and talent/clients are ownership-based", () => {
    const m = accessMatrix();
    expect(m.roles.map((r) => r.key)).toEqual([...STAFF_ROLES]);
    const listed = m.groups.flatMap((g) => g.permissions.map((p) => p.key));
    expect(new Set(listed)).toEqual(new Set(ALL_PERMISSION_KEYS));
    expect(m.roles.find((r) => r.key === "SUPER_ADMIN")!.count).toBe(ALL_PERMISSION_KEYS.length);
    for (const g of m.groups) for (const p of g.permissions) for (const r of STAFF_ROLES) expect(p.roles.includes(r)).toBe(ROLE_PERMISSIONS[r].includes(p.key));
    expect(m.ownershipRoles.map((r) => r.key)).toEqual(["AGENT", "CLIENT"]);
    expect(permissionGroups().map((g) => g.group)).toContain("system");
  });
});
