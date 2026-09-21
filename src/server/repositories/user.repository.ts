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
        clientContact: { select: { clientId: true } },
        agentProfile: { select: { id: true } },
        managedClients: { select: { id: true } },
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

  roleIdByKey(db: Db, key: "SUPER_ADMIN" | "ADMIN" | "SALES" | "RECRUITER" | "COACH" | "OPERATIONS" | "AGENT" | "CLIENT") {
    return db.role.findUniqueOrThrow({ where: { key }, select: { id: true } });
  },

  idsByRole(db: Db, keys: Array<"SUPER_ADMIN" | "ADMIN" | "SALES" | "RECRUITER" | "COACH" | "OPERATIONS">) {
    return db.user.findMany({ where: { status: "ACTIVE", deletedAt: null, role: { key: { in: keys } } }, select: { id: true, email: true } });
  },
};
