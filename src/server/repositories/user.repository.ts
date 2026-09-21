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
    return db.user.findUnique({ where: { email } });
  },
};
