import type { Prisma, AgreementType, AcceptanceContext, RoleKey, PrivacyPolicyMode } from "@prisma/client";
import type { Db } from "@/server/db/types";

export const TERMS_TYPES = ["PLATFORM_TERMS", "PRIVACY_POLICY"] as const;
export type TermsType = (typeof TERMS_TYPES)[number];

const versionSelect = {
  id: true, type: true, version: true, title: true, bodyMarkdown: true, bodyChecksum: true, effectiveFrom: true, isActive: true,
  requiredForRoles: true, sections: true, isMaterialChange: true, requiresReacceptance: true, privacyPolicyMode: true, changeNote: true, publishedAt: true, publishedById: true, supersedesId: true, createdAt: true,
} satisfies Prisma.AgreementSelect;

export type TermsVersionRecord = Prisma.AgreementGetPayload<{ select: typeof versionSelect }>;

export const termsRepository = {
  activeByType(db: Db, type: TermsType) {
    return db.agreement.findFirst({ where: { type, isActive: true }, orderBy: { version: "desc" }, select: versionSelect });
  },

  /** Every version of a document, newest first. */
  versionsByType(db: Db, type: TermsType) {
    return db.agreement.findMany({ where: { type }, orderBy: { version: "desc" }, select: { ...versionSelect, _count: { select: { acceptances: true } } } });
  },

  findVersion(db: Db, id: string) {
    return db.agreement.findUnique({ where: { id }, select: versionSelect });
  },

  acceptedAgreementIds(db: Db, userId: string, agreementIds: string[]) {
    if (!agreementIds.length) return Promise.resolve([] as Array<{ agreementId: string; acceptedAt: Date }>);
    return db.agreementAcceptance.findMany({ where: { userId, agreementId: { in: agreementIds }, placementId: null }, select: { agreementId: true, acceptedAt: true } });
  },

  /** One acceptance per user and version; a repeat returns the existing row. Contextual acceptances (an agency application) are always recorded. */
  async recordAcceptance(db: Db, d: { agreementId: string; userId: string; role: RoleKey; agencyId: string | null; bodyChecksum: string; context: AcceptanceContext; applicationId?: string | null; ipAddress?: string | null; userAgent?: string | null }) {
    const contextual = d.context === "AGENCY_APPLICATION" || d.context === "INDEPENDENT_REAPPLICATION";
    const existing = contextual ? null : await db.agreementAcceptance.findFirst({ where: { agreementId: d.agreementId, userId: d.userId, placementId: null }, select: { id: true, acceptedAt: true } });
    if (existing) return { ...existing, created: false };
    const row = await db.agreementAcceptance.create({ data: { agreementId: d.agreementId, userId: d.userId, role: d.role, agencyId: d.agencyId ?? undefined, bodyChecksum: d.bodyChecksum, context: d.context, applicationId: d.applicationId ?? undefined, ipAddress: d.ipAddress ?? undefined, userAgent: d.userAgent ?? undefined }, select: { id: true, acceptedAt: true } });
    return { ...row, created: true };
  },

  deactivateType(db: Db, type: TermsType) {
    return db.agreement.updateMany({ where: { type, isActive: true }, data: { isActive: false } });
  },

  createVersion(db: Db, d: { type: TermsType; version: number; title: string; bodyMarkdown: string; bodyChecksum: string; effectiveFrom: Date; requiredForRoles: RoleKey[]; sections: Prisma.InputJsonValue; isMaterialChange: boolean; requiresReacceptance: boolean; privacyPolicyMode: PrivacyPolicyMode; changeNote: string | null; publishedById: string | null; supersedesId: string | null }) {
    return db.agreement.create({ data: { ...d, isActive: true, changeNote: d.changeNote ?? undefined, publishedById: d.publishedById ?? undefined, supersedesId: d.supersedesId ?? undefined, publishedAt: new Date() }, select: versionSelect });
  },

  /** Users the terms apply to, with every acceptance of the two documents (newest first). */
  usersForAcceptanceReport(db: Db, p: { roles: RoleKey[]; agencyId?: string | null; q?: string | null; take?: number }) {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      role: { key: { in: p.roles } },
      ...(p.agencyId ? { agencyUsers: { some: { agencyId: p.agencyId } } } : {}),
      ...(p.q ? { email: { contains: p.q, mode: "insensitive" } } : {}),
    };
    return db.user.findMany({
      where,
      select: {
        id: true, email: true, status: true, createdAt: true,
        role: { select: { key: true } },
        agencyUsers: { take: 1, select: { agencyId: true, agency: { select: { name: true } } } },
        agreementAcceptances: { where: { placementId: null, agreement: { type: { in: [...TERMS_TYPES] as AgreementType[] } } }, orderBy: { acceptedAt: "desc" }, select: { agreementId: true, acceptedAt: true, context: true, agreement: { select: { type: true, version: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: p.take ?? 500,
    });
  },

  /** Acceptance rows for one user, newest first (account page). */
  acceptancesForUser(db: Db, userId: string) {
    return db.agreementAcceptance.findMany({ where: { userId, agreement: { type: { in: [...TERMS_TYPES] as AgreementType[] } } }, orderBy: { acceptedAt: "desc" }, select: { id: true, acceptedAt: true, context: true, ipAddress: true, agreement: { select: { type: true, version: true, title: true } } } });
  },
};
