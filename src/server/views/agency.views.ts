import type { Prisma } from "@/server/db/types";
import type { applicationInclude, agencyInclude } from "@/server/repositories/agency.repository";

/**
 * Allowlist projections for the agency marketplace (INV-A3).
 * Applicants never see reviewer identity or internal notes; agency users never see Hirewise-internal fields.
 */
type ApplicationRecord = Prisma.AgencyApplicationGetPayload<{ include: typeof applicationInclude }>;
type AgencyRecord = Prisma.AgencyGetPayload<{ include: typeof agencyInclude }>;
export type ApplicationDocument = { id: string; name: string; createdAt: Date };

function documentName(storageKey: string) {
  const tail = storageKey.split("/").pop() ?? storageKey;
  const i = tail.indexOf("__");
  return i >= 0 ? tail.slice(i + 2) : tail;
}

export function toApplicationDocumentView(d: { id: string; storageKey: string; createdAt: Date }): ApplicationDocument {
  return { id: d.id, name: documentName(d.storageKey), createdAt: d.createdAt };
}

const formFields = (a: ApplicationRecord) => ({
  applicantFullName: a.applicantFullName,
  applicantEmail: a.applicantEmail,
  applicantPhone: a.applicantPhone,
  proposedAgencyName: a.proposedAgencyName,
  preferredPlanKey: a.preferredPlanKey,
  hasLogo: !!a.proposedLogoKey,
  businessRegistration: a.businessRegistration,
  country: a.country,
  city: a.city,
  website: a.website,
  socialLinks: a.socialLinks,
  teamSize: a.teamSize,
  yearsExperience: a.yearsExperience,
  services: a.services,
  description: a.description,
});

/** What the applicant sees: their own answers, the status, and Hirewise's visible messages. Never reviewer or internal notes. */
export function toApplicationApplicantView(a: ApplicationRecord, documents: ApplicationDocument[]) {
  return {
    id: a.id,
    status: a.status,
    ...formFields(a),
    applicantVisibleMessage: a.applicantVisibleMessage,
    rejectionReason: a.rejectionReason,
    reapplyAfter: a.reapplyAfter,
    submittedAt: a.submittedAt,
    resubmittedAt: a.resubmittedAt,
    reviewedAt: a.reviewedAt,
    agreementAccepted: !!a.agreementAcceptanceId,
    createdAgencyId: a.createdAgencyId,
    documents,
    timeline: a.history.map((h) => ({ at: h.changedAt, from: h.previousStatus, to: h.newStatus })),
  };
}
export type ApplicationApplicantView = ReturnType<typeof toApplicationApplicantView>;

/** What reviewers see: everything, including internal notes and the applicant's account. */
export function toApplicationStaffView(a: ApplicationRecord, documents: ApplicationDocument[]) {
  return {
    id: a.id,
    status: a.status,
    ...formFields(a),
    applicant: { userId: a.applicant.id, email: a.applicant.email, role: a.applicant.role.key, hasAgentProfile: !!a.applicant.agentProfiles[0] },
    reviewer: a.reviewer ? { userId: a.reviewer.id, label: a.reviewer.email.split("@")[0] } : null,
    reviewNotes: a.reviewNotes,
    applicantVisibleMessage: a.applicantVisibleMessage,
    rejectionReason: a.rejectionReason,
    reapplyAfter: a.reapplyAfter,
    submittedAt: a.submittedAt,
    resubmittedAt: a.resubmittedAt,
    reviewedAt: a.reviewedAt,
    agreementAccepted: !!a.agreementAcceptanceId,
    createdAgencyId: a.createdAgencyId,
    documents,
    history: a.history.map((h) => ({ at: h.changedAt, from: h.previousStatus, to: h.newStatus, by: h.changedBy ? h.changedBy.email.split("@")[0] : "applicant", notes: h.notes })),
  };
}
export type ApplicationStaffView = ReturnType<typeof toApplicationStaffView>;

/** The agency as its owner and managers see it. No reviewer notes, no Hirewise-internal flags beyond status. */
export function toAgencyOwnerView(a: AgencyRecord) {
  return {
    id: a.id,
    name: a.name,
    hasLogo: !!a.logoKey,
    description: a.description,
    contactEmail: a.contactEmail,
    contactPhone: a.contactPhone,
    country: a.country,
    city: a.city,
    website: a.website,
    status: a.status,
    statusReason: a.status === "ACTIVE" ? null : a.statusReason,
    trainingAccess: a.trainingAccess,
    opportunityAccess: a.opportunityAccess,
    joinedAt: a.joinedAt,
    agentCount: a._count.primaryAgents,
    seats: a.users.map((u) => ({ userId: u.userId, email: u.user.email, role: u.role, permissions: u.permissions })),
    // v2 phase 5: private identity (owner and Hirewise only) and the read-only client-facing identity.
    legalName: a.legalName,
    addressLine: a.addressLine,
    registrationDetails: a.registrationDetails,
    billingEmail: a.billingEmail,
    clientFacing: a.clientFacingCode ? { code: a.clientFacingCode, name: a.clientFacingName ?? `Hirewise Certified Partner Team ${a.clientFacingCode}`, specializations: a.clientFacingSpecializations } : null,
  };
}
export type AgencyOwnerView = ReturnType<typeof toAgencyOwnerView>;

/** The agency as Hirewise staff see it. */
export function toAgencyStaffView(a: AgencyRecord) {
  return {
    ...toAgencyOwnerView(a),
    statusReason: a.statusReason,
    owner: { userId: a.ownerUserId, email: a.owner.email },
    applicationId: a.application?.id ?? null,
    suspendedAt: a.suspendedAt,
    deactivatedAt: a.deactivatedAt,
    membershipCount: a._count.memberships,
  };
}
export type AgencyStaffView = ReturnType<typeof toAgencyStaffView>;
