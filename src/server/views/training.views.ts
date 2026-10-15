import type { CoursePurchaseRecord } from "@/server/repositories/training.repository";
import { formatMoney } from "@/server/views/seat.views";

export function toCourseCatalogView(c: { id: string; title: string; category: string; description: string | null; priceCents: number; certificationTemplate: { name: string } | null; _count: { modules: number } }, seats?: { bought: number; used: number }) {
  return {
    id: c.id,
    title: c.title,
    category: c.category,
    description: c.description,
    priceCents: c.priceCents,
    priceLabel: c.priceCents === 0 ? "Free" : `${formatMoney(c.priceCents, "USD")} per seat`,
    certification: c.certificationTemplate?.name ?? null,
    modules: c._count.modules,
    seatsBought: seats?.bought ?? 0,
    seatsUsed: seats?.used ?? 0,
    seatsAvailable: Math.max(0, (seats?.bought ?? 0) - (seats?.used ?? 0)),
  };
}
export type CourseCatalogView = ReturnType<typeof toCourseCatalogView>;

export function toCoursePurchaseView(p: CoursePurchaseRecord) {
  return { id: p.id, agencyId: p.agencyId, agencyName: p.agency.name, courseId: p.courseId, courseTitle: p.course.title, seatCount: p.seatCount, assigned: p._count.assignments, amountMinor: p.amountMinor, currency: p.currency, amountLabel: formatMoney(p.amountMinor, p.currency), status: p.status, paymentReference: p.paymentReference, paidAt: p.paidAt, note: p.note, createdAt: p.createdAt };
}
export type CoursePurchaseView = ReturnType<typeof toCoursePurchaseView>;

type MemberTrainingRecord = {
  id: string;
  status: string;
  agentProfile: {
    id: string; displayName: string; primaryRole: string | null; verificationLevel: string;
    enrollments: Array<{ id: string; status: string; credentialSource: string; sponsoringAgencyId: string | null; accessRevokedAt: Date | null; enrolledAt: Date; course: { id: string; title: string }; completion: { completedAt: Date; examScore: number | null } | null }>;
    courseProgress: Array<{ courseId: string; percent: number }>;
    certifications: Array<{ id: string; status: string; credentialSource: string; sponsoringAgencyId: string | null; issuedAt: Date; expiresAt: Date | null; template: { name: string } }>;
    assessments: Array<{ id: string; status: string; type: string; credentialSource: string; sponsoringAgencyId: string | null; assessedAt: Date; resultLabel: { label: string } | null; course: { title: string } | null }>;
  };
};

/** The agency sees its members' training with source and status; nothing private, no coach comments. */
export function toMemberTrainingView(m: MemberTrainingRecord, agencyId: string) {
  const sourceLabel = (s: string, sponsor: string | null) => (s === "AGENCY_SPONSORED" ? (sponsor === agencyId ? "Sponsored by you" : "Sponsored by another agency") : s === "INDEPENDENT_PURCHASE" ? "Bought by the agent" : s === "ADMIN_ASSIGNMENT" ? "Assigned by Hirewise" : "Hirewise direct");
  const progress = new Map(m.agentProfile.courseProgress.map((p) => [p.courseId, p.percent]));
  return {
    membershipId: m.id,
    membershipStatus: m.status,
    agentProfileId: m.agentProfile.id,
    displayName: m.agentProfile.displayName,
    primaryRole: m.agentProfile.primaryRole,
    verificationLevel: m.agentProfile.verificationLevel,
    courses: m.agentProfile.enrollments.map((e) => ({ enrollmentId: e.id, courseId: e.course.id, title: e.course.title, status: e.status, revoked: e.status === "REVOKED" || !!e.accessRevokedAt, percent: e.completion ? 100 : (progress.get(e.course.id) ?? 0), completedAt: e.completion?.completedAt ?? null, source: sourceLabel(e.credentialSource, e.sponsoringAgencyId), sponsoredByYou: e.credentialSource === "AGENCY_SPONSORED" && e.sponsoringAgencyId === agencyId })),
    certifications: m.agentProfile.certifications.map((c) => ({ id: c.id, name: c.template.name, status: c.status, active: c.status === "APPROVED", issuedAt: c.issuedAt, expiresAt: c.expiresAt, source: sourceLabel(c.credentialSource, c.sponsoringAgencyId) })),
    assessments: m.agentProfile.assessments.map((a) => ({ id: a.id, type: a.type, status: a.status, active: a.status === "FINAL", label: a.resultLabel?.label ?? null, courseTitle: a.course?.title ?? null, assessedAt: a.assessedAt, source: sourceLabel(a.credentialSource, a.sponsoringAgencyId) })),
  };
}
export type MemberTrainingView = ReturnType<typeof toMemberTrainingView>;
