import { describe, expect, it } from "vitest";
import { makeActor, resolvePermissions } from "@/server/auth/actor";
import { authorize, authorizeAny, can, ForbiddenError } from "@/server/policies/authorize";
import { ALL_PERMISSION_KEYS, ROLE_PERMISSIONS, type PermissionKey, type RoleKey } from "@/server/policies/permissions";

const ALL_ROLES = Object.keys(ROLE_PERMISSIONS) as RoleKey[];

describe("authorize()", () => {
  it("passes when the actor holds the permission", () => {
    expect(() => authorize(makeActor("ADMIN"), "agent.approve")).not.toThrow();
  });

  it("throws ForbiddenError with the permission name when missing", () => {
    const err = (() => {
      try {
        authorize(makeActor("SALES"), "agent.approve");
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(ForbiddenError);
    expect((err as ForbiddenError).permission).toBe("agent.approve");
    expect((err as ForbiddenError).status).toBe(403);
  });

  it("authorizeAny passes on any match and fails on none", () => {
    expect(() => authorizeAny(makeActor("COACH"), ["assessment.write", "rbac.manage"])).not.toThrow();
    expect(() => authorizeAny(makeActor("COACH"), ["rbac.manage", "compensation.read"])).toThrow(ForbiddenError);
  });

  it("can() mirrors authorize() without throwing", () => {
    expect(can(makeActor("OPERATIONS"), "placement.activate")).toBe(true);
    expect(can(makeActor("OPERATIONS"), "billing_rate.approve")).toBe(false);
  });
});

describe("role matrix invariants (Section 1 and 7)", () => {
  it("AGENT and CLIENT hold no catalog permissions", () => {
    expect(ROLE_PERMISSIONS.AGENT).toHaveLength(0);
    expect(ROLE_PERMISSIONS.CLIENT).toHaveLength(0);
  });

  it("SUPER_ADMIN holds every permission", () => {
    expect(new Set(ROLE_PERMISSIONS.SUPER_ADMIN)).toEqual(new Set(ALL_PERMISSION_KEYS));
  });

  it("only SUPER_ADMIN can read compensation by role (INV-C1)", () => {
    for (const role of ALL_ROLES) {
      const holds = ROLE_PERMISSIONS[role].includes("compensation.read");
      expect(holds, `${role} compensation.read`).toBe(role === "SUPER_ADMIN");
    }
  });

  it("SALES can propose but never approve billing rates (INV-C3)", () => {
    expect(ROLE_PERMISSIONS.SALES).toContain("billing_rate.propose");
    expect(ROLE_PERMISSIONS.SALES).not.toContain("billing_rate.approve");
  });

  it("only ADMIN and SUPER_ADMIN can override deposits (INV-C5)", () => {
    for (const role of ALL_ROLES) {
      const holds = ROLE_PERMISSIONS[role].includes("deposit.override");
      expect(holds, `${role} deposit.override`).toBe(role === "SUPER_ADMIN" || role === "ADMIN");
    }
  });

  it("COACH has no financial permissions (INV-P5)", () => {
    const financial = ROLE_PERMISSIONS.COACH.filter((p) => /^(billing_rate|compensation|deposit|invoice|payment)\./.test(p));
    expect(financial).toEqual([]);
  });

  it("every role permission exists in the catalog", () => {
    const catalog = new Set<string>(ALL_PERMISSION_KEYS);
    for (const role of ALL_ROLES) for (const p of ROLE_PERMISSIONS[role]) expect(catalog.has(p), `${role}:${p}`).toBe(true);
  });
});

describe("resolvePermissions()", () => {
  it("adds active overrides and ignores expired ones", () => {
    const now = new Date("2026-09-21T00:00:00Z");
    const perms = resolvePermissions(
      "ADMIN",
      [
        { permission: "compensation.read", expiresAt: null },
        { permission: "rbac.manage", expiresAt: new Date("2026-01-01T00:00:00Z") },
      ],
      now,
    );
    expect(perms.has("compensation.read")).toBe(true);
    expect(perms.has("rbac.manage")).toBe(false);
  });

  it("does not mutate the shared role list", () => {
    const before = ROLE_PERMISSIONS.RECRUITER.length;
    resolvePermissions("RECRUITER", [{ permission: "audit.read" as PermissionKey, expiresAt: null }]);
    expect(ROLE_PERMISSIONS.RECRUITER.length).toBe(before);
  });
});
