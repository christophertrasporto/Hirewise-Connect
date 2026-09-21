import type { ClientStatus } from "@prisma/client";
import type { Db } from "@/server/db/types";

export type ClientRegistrationData = {
  userId: string;
  companyName: string;
  industry: string;
  website: string | null;
  country: string;
  timezone: string;
  contact: { name: string; position: string; businessEmail: string; phone: string | null };
  onboarding: { servicesNeeded: string[]; agentsRequired: number; preferredSchedule: string | null; expectedStartDate: Date | null; notes: string | null };
};

export const clientRepository = {
  createWithContact(db: Db, d: ClientRegistrationData) {
    return db.client.create({
      data: {
        companyName: d.companyName,
        industry: d.industry,
        website: d.website ?? undefined,
        country: d.country,
        timezone: d.timezone,
        status: "PENDING_REVIEW",
        source: "self_registration",
        contacts: { create: { userId: d.userId, name: d.contact.name, position: d.contact.position, businessEmail: d.contact.businessEmail, phone: d.contact.phone ?? undefined, isPrimary: true } },
        onboarding: { create: { ...d.onboarding, preferredSchedule: d.onboarding.preferredSchedule ?? undefined, expectedStartDate: d.onboarding.expectedStartDate ?? undefined, notes: d.onboarding.notes ?? undefined } },
      },
      include: { contacts: true, onboarding: true },
    });
  },

  findById(db: Db, id: string) {
    return db.client.findUnique({ where: { id, deletedAt: null }, include: { contacts: true, onboarding: true, accountManager: { select: { id: true, email: true } } } });
  },

  listByStatus(db: Db, status: ClientStatus | undefined, take = 100) {
    return db.client.findMany({
      where: { deletedAt: null, ...(status ? { status } : {}) },
      include: { contacts: { where: { isPrimary: true } }, onboarding: true, accountManager: { select: { id: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take,
    });
  },

  setStatus(db: Db, id: string, status: ClientStatus) {
    return db.client.update({ where: { id }, data: { status } });
  },

  setAccountManager(db: Db, id: string, accountManagerUserId: string | null) {
    return db.client.update({ where: { id }, data: { accountManagerUserId } });
  },

  countByStatus(db: Db) {
    return db.client.groupBy({ by: ["status"], _count: { _all: true }, where: { deletedAt: null } });
  },
};
