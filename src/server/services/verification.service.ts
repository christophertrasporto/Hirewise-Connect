import { z } from "zod";
import type { Db, PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorize } from "@/server/policies/authorize";
import { certificationRepository } from "@/server/repositories/certification.repository";
import { agentRepository } from "@/server/repositories/agent.repository";
import { audit } from "@/server/audit/audit";

export const LEVELS = ["PROFILE_SUBMITTED", "PROFILE_VERIFIED", "SKILLS_ASSESSED", "HIREWISE_CERTIFIED", "INTERVIEW_READY", "DEPLOYMENT_READY"] as const;
export type Level = (typeof LEVELS)[number];

export const rulesSchema = z.object({
  profileApproved: z.boolean().optional(),
  videoApproved: z.boolean().optional(),
  minApprovedRecordings: z.number().int().min(0).optional(),
  minApprovedCertifications: z.number().int().min(0).optional(),
  minAssessmentLabelRank: z.number().int().min(0).optional(),
  /** Requires a PUBLISHED client billing rate (Phase 4). Until then no profile satisfies it. */
  publishedBillingRate: z.boolean().optional(),
});
export type Rules = z.infer<typeof rulesSchema>;

/** Defaults seeded on first run; admins edit them (Section "Profile verification"). */
export const DEFAULT_REQUIREMENTS: Record<Level, Rules> = {
  PROFILE_SUBMITTED: {},
  PROFILE_VERIFIED: { profileApproved: true },
  SKILLS_ASSESSED: { profileApproved: true, minAssessmentLabelRank: 1 },
  HIREWISE_CERTIFIED: { profileApproved: true, minApprovedCertifications: 1 },
  INTERVIEW_READY: { profileApproved: true, minApprovedCertifications: 1, videoApproved: true, minApprovedRecordings: 1 },
  DEPLOYMENT_READY: { profileApproved: true, minApprovedCertifications: 1, videoApproved: true, minApprovedRecordings: 1, minAssessmentLabelRank: 3, publishedBillingRate: true },
};

type Facts = { profileApproved: boolean; videoApproved: boolean; approvedRecordings: number; approvedCertifications: number; bestAssessmentRank: number; publishedBillingRate: boolean };

export function satisfies(rules: Rules, f: Facts): boolean {
  if (rules.profileApproved && !f.profileApproved) return false;
  if (rules.videoApproved && !f.videoApproved) return false;
  if ((rules.minApprovedRecordings ?? 0) > f.approvedRecordings) return false;
  if ((rules.minApprovedCertifications ?? 0) > f.approvedCertifications) return false;
  if ((rules.minAssessmentLabelRank ?? 0) > f.bestAssessmentRank) return false;
  if (rules.publishedBillingRate && !f.publishedBillingRate) return false;
  return true;
}

/** Highest level whose rules (and all lower levels' rules) are satisfied. */
export function computeLevel(requirements: Record<Level, Rules>, f: Facts): Level {
  let result: Level = "PROFILE_SUBMITTED";
  for (const level of LEVELS) {
    if (!satisfies(requirements[level] ?? {}, f)) break;
    result = level;
  }
  return result;
}

export async function loadRequirements(db: Db): Promise<Record<Level, Rules>> {
  const rows = await certificationRepository.requirements(db);
  const out = { ...DEFAULT_REQUIREMENTS };
  for (const r of rows) {
    const parsed = rulesSchema.safeParse(r.rules);
    if (parsed.success) out[r.level as Level] = parsed.data;
  }
  return out;
}

/**
 * Section 5.6: recompute after any relevant event. A manual level survives until a recompute
 * confirms it or produces a different value; then the flag clears.
 */
export async function recomputeVerification(db: Db, agentProfileId: string, actor?: Actor): Promise<Level> {
  const facts = await certificationRepository.factsFor(db, agentProfileId);
  if (!facts) return "PROFILE_SUBMITTED";
  const requirements = await loadRequirements(db);
  const f: Facts = {
    profileApproved: facts.status === "APPROVED",
    videoApproved: facts.videos.length > 0,
    approvedRecordings: facts.recordings.length,
    approvedCertifications: facts.certifications.length,
    bestAssessmentRank: Math.max(0, ...facts.assessments.map((a) => a.resultLabel?.rank ?? 0)),
    publishedBillingRate: false, // Phase 4 wires ClientBillingRate
  };
  const level = computeLevel(requirements, f);
  if (level !== facts.verificationLevel || facts.verificationIsManual) {
    await agentRepository.setVerification(db, agentProfileId, level, false);
    if (actor) await audit(db, { actor, action: "VERIFICATION_RECOMPUTED", entityType: "AgentProfile", entityId: agentProfileId, previousValue: { level: facts.verificationLevel, manual: facts.verificationIsManual }, newValue: { level } });
  }
  return level;
}

export async function setVerificationManually(db: PrismaClient, actor: Actor, agentProfileId: string, level: Level, reason: string) {
  authorize(actor, "agent.set_verification");
  if (!reason.trim()) throw new Error("A reason is required for a manual verification change.");
  await db.$transaction(async (tx) => {
    const before = await certificationRepository.factsFor(tx, agentProfileId);
    await agentRepository.setVerification(tx, agentProfileId, level, true);
    await audit(tx, { actor, action: "VERIFICATION_SET_MANUALLY", entityType: "AgentProfile", entityId: agentProfileId, previousValue: { level: before?.verificationLevel }, newValue: { level, manual: true }, reason });
  });
}

export async function getRequirements(db: PrismaClient, actor: Actor) {
  authorize(actor, "verification.manage");
  return loadRequirements(db);
}

export async function updateRequirement(db: PrismaClient, actor: Actor, level: Level, rules: Rules) {
  authorize(actor, "verification.manage");
  const parsed = rulesSchema.parse(rules);
  await db.$transaction(async (tx) => {
    await certificationRepository.upsertRequirement(tx, level, parsed);
    await audit(tx, { actor, action: "VERIFICATION_REQUIREMENT_CHANGED", entityType: "VerificationRequirement", entityId: level, newValue: parsed });
  });
}
