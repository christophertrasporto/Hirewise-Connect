import type { Prisma, IdentityContactKind, IdentityContactSource, DuplicateFlagKind, DuplicateFlagStatus } from "@prisma/client";
import type { Db } from "@/server/db/types";

export type ContactInput = { kind: IdentityContactKind; valueNormalized: string; valueDisplay: string; source: IdentityContactSource; verifiedAt?: Date | null };

const identityDetailInclude = {
  user: { select: { id: true, email: true, status: true, createdAt: true, lastLoginAt: true, role: { select: { key: true } } } },
  contacts: { orderBy: { createdAt: "asc" as const } },
  profiles: {
    orderBy: { createdAt: "asc" as const },
    select: {
      id: true, displayName: true, status: true, talentType: true, archivedAt: true, createdAt: true, primaryAgencyId: true,
      primaryAgency: { select: { id: true, name: true } },
      agencyMemberships: { orderBy: { joinedAt: "asc" as const }, select: { id: true, status: true, isPrimary: true, joinedAt: true, leftAt: true, endReason: true, agency: { select: { id: true, name: true } } } },
      placements: { select: { id: true, status: true, positionTitle: true, startDate: true, endedAt: true } },
      certifications: { select: { id: true, status: true, issuedAt: true, template: { select: { name: true } } } },
      enrollments: { select: { id: true, status: true, source: true, course: { select: { title: true } } } },
    },
  },
  duplicateFlags: { orderBy: { createdAt: "desc" as const }, select: { id: true, kind: true, status: true, attemptedEmail: true, matchReasons: true, createdAt: true, reviewedAt: true } },
} satisfies Prisma.PlatformIdentityInclude;

export type IdentityDetailRecord = Prisma.PlatformIdentityGetPayload<{ include: typeof identityDetailInclude }>;

const flagInclude = {
  matchedIdentity: { select: { id: true, primaryEmail: true, userId: true, user: { select: { email: true, role: { select: { key: true } } } } } },
  reviewedBy: { select: { email: true } },
} satisfies Prisma.DuplicateFlagInclude;

export type DuplicateFlagRecord = Prisma.DuplicateFlagGetPayload<{ include: typeof flagInclude }>;

export const identityRepository = {
  // ---- identities
  createIdentity(db: Db, d: { userId: string; primaryEmail: string; verifiedAt?: Date | null; contacts: ContactInput[] }) {
    return db.platformIdentity.create({
      data: {
        userId: d.userId,
        primaryEmail: d.primaryEmail,
        verifiedAt: d.verifiedAt ?? undefined,
        contacts: { create: d.contacts.map((c) => ({ kind: c.kind, valueNormalized: c.valueNormalized, valueDisplay: c.valueDisplay, source: c.source, verifiedAt: c.verifiedAt ?? undefined })) },
      },
      select: { id: true },
    });
  },

  findByUserId(db: Db, userId: string) {
    return db.platformIdentity.findUnique({ where: { userId }, select: { id: true, status: true, primaryEmail: true } });
  },

  findDetail(db: Db, id: string) {
    return db.platformIdentity.findUnique({ where: { id }, include: identityDetailInclude });
  },

  list(db: Db, q: string | undefined, take = 50) {
    const where: Prisma.PlatformIdentityWhereInput = q
      ? { OR: [{ primaryEmail: { contains: q, mode: "insensitive" } }, { contacts: { some: { valueNormalized: { contains: q.toLowerCase() } } } }, { profiles: { some: { displayName: { contains: q, mode: "insensitive" } } } }] }
      : {};
    return db.platformIdentity.findMany({
      where,
      select: { id: true, primaryEmail: true, status: true, createdAt: true, user: { select: { role: { select: { key: true } }, status: true } }, profiles: { where: { archivedAt: null }, select: { id: true, displayName: true, talentType: true, status: true }, take: 1 }, _count: { select: { profiles: true, duplicateFlags: true } } },
      orderBy: { createdAt: "desc" },
      take,
    });
  },

  /** Adds a contact if the identity does not have it yet. */
  addContact(db: Db, identityId: string, c: ContactInput) {
    return db.platformIdentityContact.upsert({
      where: { identityId_kind_valueNormalized: { identityId, kind: c.kind, valueNormalized: c.valueNormalized } },
      create: { identityId, kind: c.kind, valueNormalized: c.valueNormalized, valueDisplay: c.valueDisplay, source: c.source, verifiedAt: c.verifiedAt ?? undefined },
      update: { valueDisplay: c.valueDisplay, ...(c.verifiedAt ? { verifiedAt: c.verifiedAt } : {}) },
      select: { id: true, identityId: true },
    });
  },

  /** Contacts matching any of the normalised values, with enough of the identity to explain the match. */
  findContactMatches(db: Db, p: { emails: string[]; phones: string[] }) {
    const or: Prisma.PlatformIdentityContactWhereInput[] = [];
    if (p.emails.length) or.push({ kind: "EMAIL", valueNormalized: { in: p.emails } });
    if (p.phones.length) or.push({ kind: "PHONE", valueNormalized: { in: p.phones } });
    if (!or.length) return Promise.resolve([]);
    return db.platformIdentityContact.findMany({
      where: { OR: or },
      select: {
        kind: true,
        valueNormalized: true,
        identity: {
          select: {
            id: true, userId: true, status: true, primaryEmail: true,
            user: { select: { email: true, role: { select: { key: true } } } },
            profiles: { where: { archivedAt: null }, select: { id: true, talentType: true, agencyMemberships: { where: { status: "ACTIVE", agencyId: { not: null } }, select: { id: true }, take: 1 } }, take: 1 },
          },
        },
      },
    });
  },

  activeProfileForUser(db: Db, userId: string) {
    return db.agentProfile.findFirst({ where: { userId, archivedAt: null, deletedAt: null }, select: { id: true, platformIdentityId: true, talentType: true, status: true } });
  },

  // ---- duplicate flags
  createFlag(db: Db, d: { kind: DuplicateFlagKind; attemptedEmail: string; attemptedPhone: string | null; attemptedName: string; attemptedData: Record<string, unknown> | null; matchedIdentityId: string | null; matchedUserId: string | null; matchReasons: string[]; ipAddress: string | null }) {
    return db.duplicateFlag.create({ data: { ...d, attemptedData: (d.attemptedData ?? undefined) as Prisma.InputJsonValue | undefined }, select: { id: true } });
  },

  findFlag(db: Db, id: string) {
    return db.duplicateFlag.findUnique({ where: { id }, include: flagInclude });
  },

  listFlags(db: Db, status: DuplicateFlagStatus | "ALL", take = 100) {
    return db.duplicateFlag.findMany({ where: status === "ALL" ? {} : { status }, include: flagInclude, orderBy: { createdAt: "desc" }, take });
  },

  async flagCounts(db: Db) {
    const rows = await db.duplicateFlag.groupBy({ by: ["status"], _count: { _all: true } });
    return Object.fromEntries(rows.map((r) => [r.status, r._count._all])) as Partial<Record<DuplicateFlagStatus, number>>;
  },

  /** An open flag for the same attempted email within the window, so repeated attempts do not pile up. */
  recentOpenFlag(db: Db, attemptedEmail: string, since: Date) {
    return db.duplicateFlag.findFirst({ where: { attemptedEmail, status: "OPEN", createdAt: { gte: since } }, select: { id: true } });
  },

  decideFlag(db: Db, id: string, d: { status: DuplicateFlagStatus; reviewedById: string; decisionNote: string | null; continuationTokenId: string | null }) {
    return db.duplicateFlag.update({ where: { id }, data: { status: d.status, reviewedById: d.reviewedById, reviewedAt: new Date(), decisionNote: d.decisionNote ?? undefined, continuationTokenId: d.continuationTokenId ?? undefined }, select: { id: true, status: true } });
  },

  /** An approved flag that still carries a usable continuation for this email. */
  approvedFlagForEmail(db: Db, attemptedEmail: string) {
    return db.duplicateFlag.findFirst({ where: { attemptedEmail, status: "APPROVED_NEW_PROFILE", continuationTokenId: { not: null } }, orderBy: { reviewedAt: "desc" }, select: { id: true, continuationTokenId: true } });
  },
};
