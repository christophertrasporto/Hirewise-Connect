import type { Db } from "@/server/db/types";

export const userRepository = {
  /** Everything needed to build an Actor. */
  findForActor(db: Db, userId: string) {
    return db.user.findUnique({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        email: true,
        status: true,
        role: { select: { key: true } },
        permissionOverrides: { select: { expiresAt: true, permission: { select: { key: true } } } },
        agencyUsers: { take: 1, orderBy: { createdAt: "asc" }, select: { agencyId: true, role: true, permissions: true, agency: { select: { status: true } } } },
        clientContact: { select: { clientId: true } },
        agentProfiles: { where: { archivedAt: null, deletedAt: null }, take: 1, select: { id: true, platformIdentityId: true } },
        platformIdentity: { select: { id: true } },
        managedClients: { select: { id: true } },
        coursesOwned: { select: { id: true } },
        courseCoachings: { select: { courseId: true } },
      },
    });
  },

  findByEmail(db: Db, email: string) {
    return db.user.findUnique({ where: { email, deletedAt: null }, include: { role: { select: { key: true } } } });
  },

  authFlags(db: Db, userId: string) {
    return db.user.findUnique({ where: { id: userId }, select: { email: true, emailVerifiedAt: true, mfaEnabled: true } });
  },

  mfaSecret(db: Db, userId: string) {
    return db.user.findUnique({ where: { id: userId }, select: { mfaEnabled: true, mfaSecretEnc: true } });
  },

  create(db: Db, data: { email: string; passwordHash: string | null; roleId: string; emailVerifiedAt?: Date | null }) {
    return db.user.create({ data: { email: data.email, passwordHash: data.passwordHash ?? undefined, roleId: data.roleId, emailVerifiedAt: data.emailVerifiedAt ?? undefined } });
  },

  setRole(db: Db, userId: string, roleId: string) {
    return db.user.update({ where: { id: userId }, data: { roleId }, select: { id: true } });
  },

  /** For agency approval and direct creation: the account, its role, and whether it has a talent profile. */
  findForAgency(db: Db, where: { id?: string; email?: string }) {
    return db.user.findFirst({ where: { ...(where.id ? { id: where.id } : {}), ...(where.email ? { email: where.email } : {}), deletedAt: null }, select: { id: true, email: true, status: true, role: { select: { key: true } }, agentProfiles: { where: { archivedAt: null }, take: 1, select: { id: true, displayName: true } }, agencyUsers: { select: { agencyId: true } } } });
  },

  setPassword(db: Db, userId: string, passwordHash: string) {
    return db.user.update({ where: { id: userId }, data: { passwordHash } });
  },

  setEmailVerified(db: Db, userId: string) {
    return db.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
  },

  setMfa(db: Db, userId: string, data: { mfaEnabled: boolean; mfaSecretEnc: string | null }) {
    return db.user.update({ where: { id: userId }, data: { mfaEnabled: data.mfaEnabled, mfaSecretEnc: data.mfaSecretEnc } });
  },

  touchLogin(db: Db, userId: string) {
    return db.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  },

  roleIdByKey(db: Db, key: "SUPER_ADMIN" | "ADMIN" | "SALES" | "RECRUITER" | "COACH" | "OPERATIONS" | "AGENT" | "CLIENT" | "APPLICANT" | "AGENCY_OWNER" | "AGENCY_MANAGER") {
    return db.role.findUniqueOrThrow({ where: { key }, select: { id: true } });
  },

  search(db: Db, q?: string, take = 50) {
    return db.user.findMany({ where: q ? { email: { contains: q, mode: "insensitive" } } : {}, select: { id: true, email: true, status: true, deletedAt: true, createdAt: true, lastLoginAt: true, role: { select: { key: true } }, agentProfiles: { where: { archivedAt: null }, take: 1, select: { id: true, displayName: true } }, clientContact: { select: { clientId: true, client: { select: { companyName: true } } } } }, orderBy: { createdAt: "desc" }, take });
  },

  idsByRole(db: Db, keys: Array<"SUPER_ADMIN" | "ADMIN" | "SALES" | "RECRUITER" | "COACH" | "OPERATIONS">) {
    return db.user.findMany({ where: { status: "ACTIVE", deletedAt: null, role: { key: { in: keys } } }, select: { id: true, email: true } });
  },
};
