import type { MemberRecord } from "@/server/repositories/membership.repository";

/** A member as the agency (owner or manager) sees them: profile basics and membership state, never identity or private contact. */
export function toMemberView(m: MemberRecord) {
  return {
    membershipId: m.id,
    agentProfileId: m.agentProfileId,
    displayName: m.agentProfile.displayName,
    email: m.agentProfile.user.email,
    emailVerified: !!m.agentProfile.user.emailVerifiedAt,
    primaryRole: m.agentProfile.primaryRole,
    profileStatus: m.agentProfile.status,
    availabilityStatus: m.agentProfile.availabilityStatus,
    verificationLevel: m.agentProfile.verificationLevel,
    profileCompletion: m.agentProfile.profileCompletion,
    membershipStatus: m.status,
    invitationSource: m.invitationSource,
    joinedAt: m.joinedAt,
    hasSeat: !!m.seatLedgerEntryId,
  };
}
export type MemberView = ReturnType<typeof toMemberView>;

export function toEmailInviteView(i: { id: string; email: string; status: string; expiresAt: Date; createdAt: Date; acceptedAt: Date | null }) {
  return { id: i.id, email: i.email, status: i.status, expiresAt: i.expiresAt, createdAt: i.createdAt, acceptedAt: i.acceptedAt, expired: i.status === "PENDING" && i.expiresAt.getTime() <= Date.now() };
}

export function toInviteLinkView(l: { token: string; label: string; uses: number; createdAt: Date; expiresAt: Date | null }, appUrl: string) {
  return { url: `${appUrl}/join/${l.token}`, label: l.label, uses: l.uses, createdAt: l.createdAt, expiresAt: l.expiresAt };
}

/** What the public join page may show: the agency name and label, whether joining is open, and the invited email when relevant. */
export function toJoinPageView(p: { kind: "LINK" | "EMAIL"; agencyName: string; label: string; accepting: boolean; reason: string | null; email: string | null }) {
  return { kind: p.kind, agencyName: p.agencyName, label: p.label, accepting: p.accepting, reason: p.reason, email: p.email };
}
export type JoinPageView = ReturnType<typeof toJoinPageView>;
