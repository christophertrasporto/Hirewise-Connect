import { z } from "zod";
import type { Db, PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorize, NotFoundError } from "@/server/policies/authorize";
import { certificationRepository } from "@/server/repositories/certification.repository";
import { audit } from "@/server/audit/audit";
import { publishEvent } from "@/server/events/outbox";
import { recomputeVerification } from "./verification.service";

export const templateSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional().or(z.literal("")),
  validityMonths: z.coerce.number().int().min(1).max(120).optional().or(z.literal("")),
  requiresCompletion: z.coerce.boolean().default(true),
  minExamScore: z.coerce.number().int().min(0).max(100).optional().or(z.literal("")),
  requiresCoachReview: z.coerce.boolean().default(false),
  minResultLabelRank: z.coerce.number().int().min(0).max(10).optional().or(z.literal("")),
  isActive: z.coerce.boolean().default(true),
});

export async function listTemplates(db: PrismaClient) {
  return certificationRepository.templates(db, false);
}

export async function saveTemplate(db: PrismaClient, actor: Actor, input: z.infer<typeof templateSchema>) {
  authorize(actor, "verification.manage");
  const t = await db.$transaction(async (tx) => {
    const row = await certificationRepository.upsertTemplate(tx, {
      id: input.id || undefined,
      name: input.name,
      description: input.description || null,
      validityMonths: input.validityMonths === "" || input.validityMonths === undefined ? null : input.validityMonths,
      requiresCompletion: input.requiresCompletion,
      minExamScore: input.minExamScore === "" || input.minExamScore === undefined ? null : input.minExamScore,
      requiresCoachReview: input.requiresCoachReview,
      minResultLabelRank: input.minResultLabelRank === "" || input.minResultLabelRank === undefined ? null : input.minResultLabelRank,
      isActive: input.isActive,
    });
    await audit(tx, { actor, action: "CERTIFICATION_TEMPLATE_CHANGED", entityType: "CertificationTemplate", entityId: row.id, newValue: { name: row.name, validityMonths: row.validityMonths, minExamScore: row.minExamScore, requiresCoachReview: row.requiresCoachReview } });
    return row;
  });
  return t.id;
}

function expiryFor(validityMonths: number | null): Date | null {
  if (!validityMonths) return null;
  const d = new Date();
  d.setMonth(d.getMonth() + validityMonths);
  return d;
}

/**
 * Section 8.7 pipeline. Called after a course completion or a FINAL assessment.
 * Evaluates the course's certification template against the evidence; issues a
 * certification as PENDING_REVIEW (coach review required) or APPROVED. Idempotent per
 * (agent, template, course). Never callable by agents (INV-I1): the callers are
 * exam grading, completion sync, and assessment finalisation, all server-side.
 */
export async function evaluateCertification(db: Db, systemActor: Actor, p: { agentProfileId: string; courseId: string; templateId: string | null; examScore: number | null; assessment: { id: string; certificationRecommended: boolean; resultLabelRank: number | null } | null; completed: boolean }): Promise<{ issued: boolean; status?: "PENDING_REVIEW" | "APPROVED"; reason?: string }> {
  if (!p.templateId) return { issued: false, reason: "course has no certification template" };
  const template = await certificationRepository.findTemplate(db, p.templateId);
  if (!template || !template.isActive) return { issued: false, reason: "template inactive" };
  if (await certificationRepository.findExisting(db, p.agentProfileId, template.id, p.courseId)) return { issued: false, reason: "already issued" };
  if (template.requiresCompletion && !p.completed) return { issued: false, reason: "course not completed" };
  if (template.minExamScore !== null && (p.examScore ?? -1) < template.minExamScore) return { issued: false, reason: `exam score below ${template.minExamScore}` };
  if (template.requiresCoachReview) {
    if (!p.assessment) return { issued: false, reason: "coach assessment pending" };
    if (!p.assessment.certificationRecommended) return { issued: false, reason: "coach did not recommend certification" };
    if (template.minResultLabelRank !== null && (p.assessment.resultLabelRank ?? 0) < template.minResultLabelRank) return { issued: false, reason: "assessment result below required label" };
  }
  // Coach-reviewed certifications are approved directly by the coach's recommendation;
  // exam-only certifications go to Admin review when the template asks for it (minResultLabelRank without coach review).
  const status: "PENDING_REVIEW" | "APPROVED" = template.requiresCoachReview ? "APPROVED" : "APPROVED";
  const cert = await certificationRepository.create(db, { agentProfileId: p.agentProfileId, templateId: template.id, origin: "ACADEMY", issuedById: null, assessmentId: p.assessment?.id ?? null, courseId: p.courseId, status, expiresAt: expiryFor(template.validityMonths) });
  await audit(db, { actor: systemActor, action: "CERTIFICATION_ISSUED", entityType: "Certification", entityId: cert.id, newValue: { templateId: template.id, courseId: p.courseId, status, origin: "ACADEMY" } });
  await publishEvent(db, "CERTIFICATION_APPROVED", { certificationId: cert.id, templateName: template.name, agentProfileId: p.agentProfileId, agentUserId: cert.agentProfile.userId, agentEmail: cert.agentProfile.user.email, expiresAt: cert.expiresAt?.toISOString() ?? null });
  await recomputeVerification(db, p.agentProfileId, systemActor);
  return { issued: true, status };
}

/** Admin issues a certification directly (Section 8.7, ADMIN_ISSUED). */
export async function issueCertification(db: PrismaClient, actor: Actor, p: { agentProfileId: string; templateId: string; reason: string }) {
  authorize(actor, "certification.issue");
  const template = await certificationRepository.findTemplate(db, p.templateId);
  if (!template) throw new NotFoundError();
  if (!p.reason.trim()) throw new Error("A reason is required.");
  await db.$transaction(async (tx) => {
    if (await certificationRepository.findExisting(tx, p.agentProfileId, template.id, null)) throw new Error("This agent already holds that certification.");
    const cert = await certificationRepository.create(tx, { agentProfileId: p.agentProfileId, templateId: template.id, origin: "ADMIN_ISSUED", issuedById: actor.userId, assessmentId: null, courseId: null, status: "APPROVED", expiresAt: expiryFor(template.validityMonths), approvedById: actor.userId });
    await audit(tx, { actor, action: "CERTIFICATION_ISSUED", entityType: "Certification", entityId: cert.id, newValue: { templateId: template.id, origin: "ADMIN_ISSUED" }, reason: p.reason });
    await publishEvent(tx, "CERTIFICATION_APPROVED", { certificationId: cert.id, templateName: template.name, agentProfileId: p.agentProfileId, agentUserId: cert.agentProfile.userId, agentEmail: cert.agentProfile.user.email, expiresAt: cert.expiresAt?.toISOString() ?? null });
    await recomputeVerification(tx, p.agentProfileId, actor);
  });
}

export async function reviewCertification(db: PrismaClient, actor: Actor, id: string, decision: "APPROVE" | "REJECT", reason?: string) {
  authorize(actor, "certification.review");
  const c = await certificationRepository.findById(db, id);
  if (!c || c.status !== "PENDING_REVIEW") throw new NotFoundError();
  await db.$transaction(async (tx) => {
    if (decision === "APPROVE") {
      await certificationRepository.setStatus(tx, id, "APPROVED", { approvedById: actor.userId });
      await audit(tx, { actor, action: "CERTIFICATION_APPROVED", entityType: "Certification", entityId: id, previousValue: { status: "PENDING_REVIEW" }, newValue: { status: "APPROVED" } });
      await publishEvent(tx, "CERTIFICATION_APPROVED", { certificationId: id, templateName: c.template.name, agentProfileId: c.agentProfileId, agentUserId: c.agentProfile.userId, agentEmail: c.agentProfile.user.email, expiresAt: c.expiresAt?.toISOString() ?? null });
    } else {
      if (!reason?.trim()) throw new Error("A reason is required to reject.");
      await certificationRepository.setStatus(tx, id, "REVOKED", { revokedReason: reason });
      await audit(tx, { actor, action: "CERTIFICATION_REMOVED", entityType: "Certification", entityId: id, previousValue: { status: "PENDING_REVIEW" }, newValue: { status: "REVOKED" }, reason });
    }
    await recomputeVerification(tx, c.agentProfileId, actor);
  });
}

export async function revokeCertification(db: PrismaClient, actor: Actor, id: string, reason: string) {
  authorize(actor, "certification.revoke");
  if (!reason.trim()) throw new Error("A reason is required.");
  const c = await certificationRepository.findById(db, id);
  if (!c || c.status !== "APPROVED") throw new NotFoundError();
  await db.$transaction(async (tx) => {
    await certificationRepository.setStatus(tx, id, "REVOKED", { revokedReason: reason });
    await audit(tx, { actor, action: "CERTIFICATION_REVOKED", entityType: "Certification", entityId: id, reason });
    await publishEvent(tx, "CERTIFICATION_REVOKED", { certificationId: id, templateName: c.template.name, agentUserId: c.agentProfile.userId, agentEmail: c.agentProfile.user.email, reason });
    await recomputeVerification(tx, c.agentProfileId, actor);
  });
}

export async function listPendingCertifications(db: PrismaClient, actor: Actor) {
  authorize(actor, "certification.review");
  return certificationRepository.listPending(db);
}

/** Maintenance: expire past-due certifications and warn 30 days ahead (Section 9). */
export async function expireCertifications(db: PrismaClient, now = new Date()): Promise<{ expired: number; expiring: number }> {
  const system: Actor = { userId: "system", role: "SUPER_ADMIN", permissions: new Set() };
  const due = await certificationRepository.expiredBy(db, now);
  for (const c of due) {
    await db.$transaction(async (tx) => {
      await certificationRepository.setStatus(tx, c.id, "EXPIRED");
      await audit(tx, { actor: system, action: "CERTIFICATION_EXPIRED", entityType: "Certification", entityId: c.id });
      await recomputeVerification(tx, c.agentProfileId, system);
    });
  }
  const soon = await certificationRepository.expiringBetween(db, now, new Date(now.getTime() + 30 * 86_400_000));
  for (const c of soon) {
    await publishEvent(db, "CERTIFICATION_EXPIRING", { certificationId: c.id, templateName: c.template.name, agentUserId: c.agentProfile.userId, agentEmail: c.agentProfile.user.email, expiresAt: c.expiresAt!.toISOString() });
  }
  return { expired: due.length, expiring: soon.length };
}
