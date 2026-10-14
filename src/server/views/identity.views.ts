import type { IdentityDetailRecord, DuplicateFlagRecord } from "@/server/repositories/identity.repository";

/**
 * Hirewise-only projections (identity.read / identity.review). These are never handed to clients or agencies;
 * FORBIDDEN_FOR_CLIENT and FORBIDDEN_FOR_AGENCY list the identity keys so a projection test catches a leak.
 */
export function toIdentityStaffView(r: IdentityDetailRecord) {
  return {
    id: r.id,
    status: r.status,
    primaryEmail: r.primaryEmail,
    verifiedAt: r.verifiedAt,
    hasIdVerification: !!r.idVerificationRefs,
    notes: r.notes,
    createdAt: r.createdAt,
    user: { id: r.user.id, email: r.user.email, status: r.user.status, role: r.user.role.key, createdAt: r.user.createdAt, lastLoginAt: r.user.lastLoginAt },
    contacts: r.contacts.map((c) => ({ id: c.id, kind: c.kind, value: c.valueDisplay, normalized: c.valueNormalized, verifiedAt: c.verifiedAt, source: c.source, createdAt: c.createdAt })),
    profiles: r.profiles.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      status: p.status,
      talentType: p.talentType,
      active: p.archivedAt === null,
      archivedAt: p.archivedAt,
      createdAt: p.createdAt,
      primaryAgency: p.primaryAgency ? { id: p.primaryAgency.id, name: p.primaryAgency.name } : null,
      memberships: p.agencyMemberships.map((m) => ({ id: m.id, status: m.status, isPrimary: m.isPrimary, joinedAt: m.joinedAt, leftAt: m.leftAt, endReason: m.endReason, agency: m.agency ? { id: m.agency.id, name: m.agency.name } : null })),
      placements: p.placements.map((pl) => ({ id: pl.id, status: pl.status, positionTitle: pl.positionTitle, startDate: pl.startDate, endedAt: pl.endedAt })),
      certifications: p.certifications.map((c) => ({ id: c.id, status: c.status, issuedAt: c.issuedAt, name: c.template.name })),
      enrollments: p.enrollments.map((e) => ({ id: e.id, status: e.status, source: e.source, courseTitle: e.course.title })),
    })),
    duplicateFlags: r.duplicateFlags.map((f) => ({ id: f.id, kind: f.kind, status: f.status, attemptedEmail: f.attemptedEmail, matchReasons: f.matchReasons, createdAt: f.createdAt, reviewedAt: f.reviewedAt })),
  };
}

export type IdentityStaffView = ReturnType<typeof toIdentityStaffView>;

export function toIdentityListView(r: { id: string; primaryEmail: string; status: string; createdAt: Date; user: { role: { key: string }; status: string }; profiles: Array<{ id: string; displayName: string; talentType: string; status: string }>; _count: { profiles: number; duplicateFlags: number } }) {
  const active = r.profiles[0] ?? null;
  return {
    id: r.id,
    primaryEmail: r.primaryEmail,
    status: r.status,
    createdAt: r.createdAt,
    role: r.user.role.key,
    userStatus: r.user.status,
    activeProfile: active ? { id: active.id, displayName: active.displayName, talentType: active.talentType, status: active.status } : null,
    profileCount: r._count.profiles,
    flagCount: r._count.duplicateFlags,
  };
}

export function toDuplicateFlagView(f: DuplicateFlagRecord) {
  const data = (f.attemptedData && typeof f.attemptedData === "object" && !Array.isArray(f.attemptedData) ? f.attemptedData : {}) as Record<string, unknown>;
  return {
    id: f.id,
    kind: f.kind,
    status: f.status,
    attemptedEmail: f.attemptedEmail,
    attemptedPhone: f.attemptedPhone,
    attemptedName: f.attemptedName,
    attemptedSummary: Object.entries(data).filter(([k, v]) => typeof v === "string" && v && k !== "password").map(([k, v]) => `${k}: ${String(v)}`),
    matchReasons: f.matchReasons,
    matched: f.matchedIdentity ? { identityId: f.matchedIdentity.id, userId: f.matchedIdentity.userId, email: f.matchedIdentity.user.email, role: f.matchedIdentity.user.role.key } : f.matchedUserId ? { identityId: null, userId: f.matchedUserId, email: null, role: null } : null,
    reviewedBy: f.reviewedBy?.email ?? null,
    reviewedAt: f.reviewedAt,
    decisionNote: f.decisionNote,
    continuationIssued: !!f.continuationTokenId,
    createdAt: f.createdAt,
  };
}

export type DuplicateFlagView = ReturnType<typeof toDuplicateFlagView>;
