import type { IndependentAccessStatus } from "@prisma/client";
import type { Db } from "@/server/db/types";

/** v2 phase 4: independent reapplication records (fees recorded by Hirewise) and fresh independent profiles. */
export const independentRepository = {
  create(db: Db, d: { userId: string; platformIdentityId: string | null; status: IndependentAccessStatus; amountMinor: number; currency: string; fromProfileId: string | null; note: string | null }) {
    return db.independentAccess.create({ data: { ...d, platformIdentityId: d.platformIdentityId ?? undefined, fromProfileId: d.fromProfileId ?? undefined, note: d.note ?? undefined } });
  },
  find(db: Db, id: string) {
    return db.independentAccess.findUnique({ where: { id } });
  },
  openForUser(db: Db, userId: string) {
    return db.independentAccess.findFirst({ where: { userId, status: "PENDING_PAYMENT" }, orderBy: { createdAt: "desc" } });
  },
  latestForUser(db: Db, userId: string) {
    return db.independentAccess.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
  },
  update(db: Db, id: string, d: { status?: IndependentAccessStatus; paymentReference?: string | null; paidAt?: Date | null; recordedById?: string | null; profileId?: string | null; note?: string | null }) {
    return db.independentAccess.update({ where: { id }, data: { status: d.status, paymentReference: d.paymentReference ?? undefined, paidAt: d.paidAt ?? undefined, recordedById: d.recordedById ?? undefined, profileId: d.profileId ?? undefined, note: d.note ?? undefined } });
  },
  list(db: Db, status?: IndependentAccessStatus, take = 100) {
    return db.independentAccess.findMany({ where: status ? { status } : {}, orderBy: { createdAt: "desc" }, take });
  },
  async counts(db: Db) {
    const rows = await db.independentAccess.groupBy({ by: ["status"], _count: { _all: true } });
    return Object.fromEntries(rows.map((r) => [r.status, r._count._all])) as Partial<Record<IndependentAccessStatus, number>>;
  },
  userBasics(db: Db, userId: string) {
    return db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, role: { select: { key: true } }, platformIdentity: { select: { id: true } }, agentProfiles: { orderBy: { createdAt: "desc" }, select: { id: true, status: true, archivedAt: true, talentType: true, formerAgencyId: true } } } });
  },
  /** The newest profile of the user (archived or not) to copy the basics from. */
  latestProfile(db: Db, userId: string) {
    return db.agentProfile.findFirst({ where: { userId }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, archivedAt: true } });
  },
  archive(db: Db, agentProfileId: string) {
    return db.agentProfile.update({ where: { id: agentProfileId }, data: { status: "ARCHIVED", archivedAt: new Date() }, select: { id: true } });
  },
  /** A fresh independent profile with only the basics copied (decision 5 of phase 3 applies here too). */
  async createFreshIndependent(db: Db, fromProfileId: string, platformIdentityId: string | null, userId: string) {
    const from = await db.agentProfile.findUniqueOrThrow({ where: { id: fromProfileId }, select: { displayName: true, locationCity: true, locationCountry: true, timezone: true, primaryRole: true, privateContact: { select: { fullLegalName: true, personalEmail: true, phone: true } } } });
    return db.agentProfile.create({
      data: {
        userId,
        platformIdentityId: platformIdentityId ?? undefined,
        displayName: from.displayName,
        locationCity: from.locationCity,
        locationCountry: from.locationCountry,
        timezone: from.timezone,
        primaryRole: from.primaryRole,
        talentType: "INDEPENDENT_FREELANCER",
        status: "DRAFT",
        availabilityStatus: "UNAVAILABLE",
        privateContact: from.privateContact ? { create: { fullLegalName: from.privateContact.fullLegalName, personalEmail: from.privateContact.personalEmail ?? undefined, phone: from.privateContact.phone ?? undefined } } : undefined,
      },
      select: { id: true },
    });
  },
};
