import type { Db } from "@/server/db/types";
import { recomputeSkillVerification } from "@/server/services/skill-verification.service";
import type { Actor } from "@/server/auth/actor";
import { systemActor } from "@/server/auth/actor";
import { trainingRepository } from "@/server/repositories/training.repository";
import { audit } from "@/server/audit/audit";
import { publishEvent } from "@/server/events/outbox";
import { recomputeVerification } from "@/server/services/verification.service";

/**
 * Credential sources (v2 phase 4). Every enrollment, certification, and assessment records who funded it. Agency-
 * sponsored items stop counting for platform use when the membership ends; everything else is untouched.
 */

export type CredentialSource = "AGENCY_SPONSORED" | "INDEPENDENT_PURCHASE" | "HIREWISE_DIRECT" | "ADMIN_ASSIGNMENT";

/** The source of a self-enrolment: paid courses are independent purchases, free ones Hirewise direct. */
export function sourceForSelfEnrolment(priceCents: number): "INDEPENDENT_PURCHASE" | "HIREWISE_DIRECT" {
  return priceCents > 0 ? "INDEPENDENT_PURCHASE" : "HIREWISE_DIRECT";
}

/** Source and sponsor a certification or assessment inherits from the enrollment it came from. */
export async function inheritedSource(db: Db, courseId: string | null, agentProfileId: string): Promise<{ credentialSource: CredentialSource; sponsoringAgencyId: string | null }> {
  if (!courseId) return { credentialSource: "HIREWISE_DIRECT", sponsoringAgencyId: null };
  const e = await trainingRepository.enrollmentSourceFor(db, courseId, agentProfileId);
  return e ? { credentialSource: e.credentialSource as CredentialSource, sponsoringAgencyId: e.sponsoringAgencyId } : { credentialSource: "HIREWISE_DIRECT", sponsoringAgencyId: null };
}

export function accessRevoked(e: { status: string; accessRevokedAt: Date | null }): boolean {
  return e.status === "REVOKED" || !!e.accessRevokedAt;
}

/**
 * Exit actions for credentials (decisions 2 and 3): in-progress sponsored enrollments are revoked, completed ones keep
 * their completion but lose access, certifications become inactive for platform use, assessments historical, course
 * seats return to the agency, and the verification level is recomputed. Idempotent: already-processed rows are skipped.
 */
export async function revokeAgencySponsoredOnExit(db: Db, p: { agencyId: string; agencyName: string; agentProfileId: string; agentUserId: string; ownerUserId: string; displayName: string; membershipId: string; reason: string }): Promise<{ enrollments: number; certifications: number; assessments: number; seatsReturned: number }> {
  const actor: Actor = systemActor();
  const [enrollments, certifications, assessments, assignments] = await Promise.all([
    trainingRepository.sponsoredEnrollments(db, p.agencyId, p.agentProfileId),
    trainingRepository.sponsoredCertifications(db, p.agencyId, p.agentProfileId),
    trainingRepository.sponsoredAssessments(db, p.agencyId, p.agentProfileId),
    trainingRepository.openAssignmentsForAgent(db, p.agencyId, p.agentProfileId),
  ]);
  if (!enrollments.length && !certifications.length && !assessments.length && !assignments.length) return { enrollments: 0, certifications: 0, assessments: 0, seatsReturned: 0 };
  const reason = `Agency membership ended: ${p.reason}`;
  {
    const tx = db;
    for (const e of enrollments) {
      await trainingRepository.revokeEnrollment(tx, e.id, { status: e.status === "COMPLETED" ? null : "REVOKED", reason });
    }
    for (const c of certifications) await trainingRepository.inactivateCertification(tx, c.id, reason);
    for (const a of assessments) await trainingRepository.historicalAssessment(tx, a.id);
    for (const s of assignments) await trainingRepository.revokeAssignment(tx, s.id, reason);
    await audit(tx, { actor, action: "CREDENTIALS_REVOKED_ON_EXIT", entityType: "AgentProfile", entityId: p.agentProfileId, newValue: { agencyId: p.agencyId, membershipId: p.membershipId, enrollments: enrollments.map((e) => e.id), certifications: certifications.map((c) => c.id), assessments: assessments.map((a) => a.id), seatsReturned: assignments.length }, reason });
    await recomputeVerification(tx, p.agentProfileId, actor);
    // Skills system (decision 4): revoked sponsored completions no longer verify tags.
    await recomputeSkillVerification(tx, p.agentProfileId);
    await publishEvent(tx, "CREDENTIALS_REVOKED", { agencyId: p.agencyId, agencyName: p.agencyName, agentProfileId: p.agentProfileId, agentUserId: p.agentUserId, ownerUserId: p.ownerUserId, displayName: p.displayName, courses: enrollments.map((e) => e.course.title), certifications: certifications.map((c) => c.template.name), assessments: assessments.length, seatsReturned: assignments.length });
  }
  return { enrollments: enrollments.length, certifications: certifications.length, assessments: assessments.length, seatsReturned: assignments.length };
}
