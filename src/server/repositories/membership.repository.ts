import type { Prisma, AgencyMembershipStatus, InvitationSource, EmailInviteStatus } from "@prisma/client";
import type { Db } from "@/server/db/types";

const OPEN: AgencyMembershipStatus[] = ["INVITED", "PENDING_VERIFICATION", "ACTIVE", "EXIT_REQUESTED", "REMOVAL_REQUESTED", "ENDING"];

const memberInclude = {
  agentProfile: { select: { id: true, displayName: true, primaryRole: true, status: true, availabilityStatus: true, verificationLevel: true, profileCompletion: true, talentType: true, user: { select: { email: true, emailVerifiedAt: true } } } },
  agency: { select: { id: true, name: true, ownerUserId: true } },
} satisfies Prisma.AgencyMembershipInclude;

export type MemberRecord = Prisma.AgencyMembershipGetPayload<{ include: typeof memberInclude }>;

/** v2 phase 2: memberships, invitation links, and email invites. Hirewise Direct is the absence of an open membership. */
export const membershipRepository = {
  openForIdentity(db: Db, platformIdentityId: string) {
    return db.agencyMembership.findFirst({ where: { platformIdentityId, status: { in: OPEN } }, include: memberInclude });
  },
  openForProfile(db: Db, agentProfileId: string) {
    return db.agencyMembership.findFirst({ where: { agentProfileId, status: { in: OPEN } }, include: memberInclude });
  },
  find(db: Db, id: string) {
    return db.agencyMembership.findUnique({ where: { id }, include: memberInclude });
  },
  create(db: Db, d: { agentProfileId: string; agencyId: string; platformIdentityId: string | null; status: AgencyMembershipStatus; invitationSource: InvitationSource; approvedById: string | null; invitedEmail: string | null }) {
    return db.agencyMembership.create({ data: { ...d, isPrimary: true, platformIdentityId: d.platformIdentityId ?? undefined, approvedById: d.approvedById ?? undefined, invitedEmail: d.invitedEmail ?? undefined }, include: memberInclude });
  },
  update(db: Db, id: string, d: { status?: AgencyMembershipStatus; seatLedgerEntryId?: string | null; leftAt?: Date | null; endReason?: string | null; endedById?: string | null }) {
    return db.agencyMembership.update({ where: { id }, data: { status: d.status, seatLedgerEntryId: d.seatLedgerEntryId ?? undefined, leftAt: d.leftAt ?? undefined, endReason: d.endReason ?? undefined, endedById: d.endedById ?? undefined }, include: memberInclude });
  },
  /** Members of one agency in any open status. Always called with an agencyId that came from the actor's scope. */
  membersOf(db: Db, agencyId: string) {
    return db.agencyMembership.findMany({ where: { agencyId, status: { in: OPEN } }, orderBy: { joinedAt: "asc" }, include: memberInclude });
  },
  countOpen(db: Db, agencyId: string) {
    return db.agencyMembership.count({ where: { agencyId, status: { in: OPEN } } });
  },
  pendingVerificationForUser(db: Db, userId: string) {
    return db.agencyMembership.findMany({ where: { status: "PENDING_VERIFICATION", agentProfile: { userId } }, include: memberInclude });
  },
  expiredPendingJoins(db: Db, before: Date) {
    return db.agencyMembership.findMany({ where: { status: "PENDING_VERIFICATION", joinedAt: { lt: before } }, include: memberInclude });
  },
  profileIdentity(db: Db, agentProfileId: string) {
    return db.agentProfile.findUnique({ where: { id: agentProfileId }, select: { id: true, platformIdentityId: true, userId: true, user: { select: { email: true, emailVerifiedAt: true } } } });
  },
  setProfileAgency(db: Db, agentProfileId: string, agencyId: string | null) {
    return db.agentProfile.update({ where: { id: agentProfileId }, data: { primaryAgencyId: agencyId, talentType: agencyId ? "AGENCY_AGENT" : "HIREWISE_DIRECT" }, select: { id: true } });
  },

  // ---- invitation link
  activeLink(db: Db, agencyId: string) {
    return db.agencyInviteLink.findFirst({ where: { agencyId, active: true }, orderBy: { createdAt: "desc" } });
  },
  createLink(db: Db, d: { agencyId: string; token: string; label: string; createdById: string; expiresAt: Date | null }) {
    return db.agencyInviteLink.create({ data: { ...d, expiresAt: d.expiresAt ?? undefined } });
  },
  deactivateLinks(db: Db, agencyId: string) {
    return db.agencyInviteLink.updateMany({ where: { agencyId, active: true }, data: { active: false } });
  },
  findLinkByToken(db: Db, token: string) {
    return db.agencyInviteLink.findUnique({ where: { token }, include: { agency: { select: { id: true, name: true, status: true, planId: true } } } });
  },
  incrementLinkUses(db: Db, id: string) {
    return db.agencyInviteLink.update({ where: { id }, data: { uses: { increment: 1 } }, select: { id: true } });
  },

  // ---- email invites
  createEmailInvite(db: Db, d: { agencyId: string; email: string; token: string; invitedById: string; expiresAt: Date }) {
    return db.agencyEmailInvite.create({ data: d, include: { agency: { select: { id: true, name: true } } } });
  },
  findEmailInvite(db: Db, id: string) {
    return db.agencyEmailInvite.findUnique({ where: { id }, include: { agency: { select: { id: true, name: true, status: true, planId: true } } } });
  },
  findEmailInviteByToken(db: Db, token: string) {
    return db.agencyEmailInvite.findUnique({ where: { token }, include: { agency: { select: { id: true, name: true, status: true, planId: true } } } });
  },
  listEmailInvites(db: Db, agencyId: string, statuses?: EmailInviteStatus[], take = 100) {
    return db.agencyEmailInvite.findMany({ where: { agencyId, ...(statuses ? { status: { in: statuses } } : {}) }, orderBy: { createdAt: "desc" }, take });
  },
  openInviteCount(db: Db, agencyId: string) {
    return db.agencyEmailInvite.count({ where: { agencyId, status: "PENDING", expiresAt: { gt: new Date() } } });
  },
  openInviteForEmail(db: Db, agencyId: string, email: string) {
    return db.agencyEmailInvite.findFirst({ where: { agencyId, email, status: "PENDING", expiresAt: { gt: new Date() } } });
  },
  updateEmailInvite(db: Db, id: string, d: { status?: EmailInviteStatus; acceptedMembershipId?: string | null; acceptedAt?: Date | null }) {
    return db.agencyEmailInvite.update({ where: { id }, data: { status: d.status, acceptedMembershipId: d.acceptedMembershipId ?? undefined, acceptedAt: d.acceptedAt ?? undefined } });
  },
  expireEmailInvites(db: Db, now: Date) {
    return db.agencyEmailInvite.updateMany({ where: { status: "PENDING", expiresAt: { lte: now } }, data: { status: "EXPIRED" } });
  },
};
