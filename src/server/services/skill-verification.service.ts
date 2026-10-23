import type { Db } from "@/server/db/types";
import { skillsRepository } from "@/server/repositories/skills.repository";

/**
 * Skill verification (docs/plan-skills-tags.md, section 3). The ONLY writer of AgentSkill.verifiedAt.
 * A tag is verified when the agent's passing, non-revoked course completions satisfy the tag's configuration:
 * REQUIRED_COURSE (that course), PATHWAY (every required course of the pathway), ANY_COURSE (any course mapped to
 * the tag). NONE is never verified. Nothing a user or a staff form does writes the column; this service is called
 * after completions, certification changes, exit revocations, configuration changes, and by the worker.
 * Decision 2 of the plan: when a certification template validates the tag and the agent's certification of it was
 * revoked, expired, or deactivated (and none is approved), the tag is not verified whatever the completions say.
 */

type Completion = { courseId: string; score: number | null; hasExam: boolean };
type CertStatus = "PENDING_REVIEW" | "APPROVED" | "REVOKED" | "EXPIRED" | "INACTIVE_FOR_PLATFORM_USE";

/** True when a linked certification was lost and not replaced by an approved one. */
export function certificationBlocks(templateIds: string[], certs: Map<string, CertStatus[]>): boolean {
  for (const id of templateIds) {
    const statuses = certs.get(id) ?? [];
    if (statuses.includes("APPROVED")) continue;
    if (statuses.some((s) => s === "REVOKED" || s === "EXPIRED" || s === "INACTIVE_FOR_PLATFORM_USE")) return true;
  }
  return false;
}

function passed(c: Completion | undefined, minScore: number): boolean {
  if (!c) return false;
  if (!c.hasExam || c.score === null) return true;
  return c.score >= minScore;
}

export function evaluateTag(tag: { verificationMode: string; requiredCourseId: string | null; minAssessmentScore: number; courses: Array<{ courseId: string }>; requiredPathway: { courses: Array<{ courseId: string }> } | null; certificationTemplates?: Array<{ id: string }> }, completions: Map<string, Completion>, certs: Map<string, CertStatus[]> = new Map()): { verified: boolean; via: string | null } {
  if (certificationBlocks((tag.certificationTemplates ?? []).map((t) => t.id), certs)) return { verified: false, via: null };
  switch (tag.verificationMode) {
    case "REQUIRED_COURSE":
      return tag.requiredCourseId && passed(completions.get(tag.requiredCourseId), tag.minAssessmentScore) ? { verified: true, via: tag.requiredCourseId } : { verified: false, via: null };
    case "PATHWAY": {
      const required = tag.requiredPathway?.courses.map((c) => c.courseId) ?? [];
      if (required.length === 0) return { verified: false, via: null };
      return required.every((id) => passed(completions.get(id), tag.minAssessmentScore)) ? { verified: true, via: `pathway:${required.length}` } : { verified: false, via: null };
    }
    case "ANY_COURSE": {
      const hit = tag.courses.find((c) => passed(completions.get(c.courseId), tag.minAssessmentScore));
      return hit ? { verified: true, via: hit.courseId } : { verified: false, via: null };
    }
    default:
      return { verified: false, via: null };
  }
}

/** Recomputes every declared tag of one agent. Keeps an existing verifiedAt when the rule still holds. */
export async function recomputeSkillVerification(db: Db, agentProfileId: string): Promise<{ verified: number; cleared: number }> {
  const [tags, rows, certRows] = await Promise.all([skillsRepository.declaredTagsWithConfig(db, agentProfileId), skillsRepository.passingCompletions(db, agentProfileId), skillsRepository.certificationStatuses(db, agentProfileId)]);
  const completions = new Map<string, Completion>(rows.map((r) => [r.courseId, { courseId: r.courseId, score: r.completion?.examScore ?? null, hasExam: !!r.course.exam }]));
  const certs = new Map<string, CertStatus[]>();
  for (const c of certRows) certs.set(c.templateId, [...(certs.get(c.templateId) ?? []), c.status]);
  let verified = 0;
  let cleared = 0;
  for (const t of tags) {
    const result = evaluateTag(t.skill, completions, certs);
    if (result.verified && !t.verifiedAt) {
      await skillsRepository.setVerification(db, agentProfileId, t.skillId, { verifiedAt: new Date(), verifiedVia: result.via });
      verified++;
    } else if (result.verified && t.verifiedVia !== result.via) {
      await skillsRepository.setVerification(db, agentProfileId, t.skillId, { verifiedAt: t.verifiedAt, verifiedVia: result.via });
    } else if (!result.verified && t.verifiedAt) {
      await skillsRepository.setVerification(db, agentProfileId, t.skillId, { verifiedAt: null, verifiedVia: null });
      cleared++;
    }
  }
  return { verified, cleared };
}

/** After a tag's configuration or course mapping changes: every agent holding the tag. */
export async function recomputeForSkill(db: Db, skillId: string): Promise<number> {
  const agents = await skillsRepository.agentsHoldingTag(db, skillId);
  for (const a of agents) await recomputeSkillVerification(db, a.agentProfileId);
  return agents.length;
}

/** After a course's tags or a pathway change: every agent who completed the course. */
export async function recomputeForCourse(db: Db, courseId: string): Promise<number> {
  const agents = await skillsRepository.agentsCompletedCourse(db, courseId);
  for (const a of agents) await recomputeSkillVerification(db, a.agentProfileId);
  return agents.length;
}

/** Maintenance safety net: every agent holding a verifiable tag. */
export async function recomputeAllSkillVerifications(db: Db): Promise<number> {
  const agents = await skillsRepository.agentsHoldingAnyTag(db);
  for (const a of agents) await recomputeSkillVerification(db, a.agentProfileId);
  return agents.length;
}
