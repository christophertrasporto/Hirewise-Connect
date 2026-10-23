import type { SkillTagRecord, PathwayRecord, SkillTagRequestRecord } from "@/server/repositories/skills.repository";

/** Skills system projections. Tags are curated labels, safe for every audience. */

export function toSkillTagView(t: SkillTagRecord) {
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    hashtag: t.hashtag ?? `#${t.name.replace(/\s+/g, "")}`,
    category: t.category,
    description: t.description,
    isActive: t.isActive,
    verificationMode: t.verificationMode,
    requiredCourse: t.requiredCourse ? { id: t.requiredCourse.id, title: t.requiredCourse.title } : null,
    requiredPathway: t.requiredPathway ? { id: t.requiredPathway.id, title: t.requiredPathway.title } : null,
    minAssessmentScore: t.minAssessmentScore,
    courses: t.courses.map((c) => ({ id: c.course.id, title: c.course.title, status: c.course.status })),
    holders: t._count.agents,
  };
}
export type SkillTagView = ReturnType<typeof toSkillTagView>;

export function toPathwayView(p: PathwayRecord) {
  return { id: p.id, title: p.title, slug: p.slug, description: p.description, isActive: p.isActive, courses: p.courses.map((c) => ({ id: c.course.id, title: c.course.title, status: c.course.status, sortOrder: c.sortOrder, isRequired: c.isRequired })), tagsUsing: p._count.skills };
}

export function toSkillTagRequestView(r: SkillTagRequestRecord) {
  return { id: r.id, text: r.text, status: r.status, note: r.note, requestedBy: r.requestedBy.email, requestedByRole: r.requestedBy.role.key, mergedInto: r.mergedInto ? { id: r.mergedInto.id, name: r.mergedInto.name } : null, createdSkill: r.createdSkill ? { id: r.createdSkill.id, name: r.createdSkill.name } : null, createdAt: r.createdAt, decidedAt: r.decidedAt };
}

export function toRequirementView(r: { id: string; requiredLevel: string; skill: { id: string; name: string; hashtag: string | null } | null; certificationTemplate: { id: string; name: string } | null }) {
  return { id: r.id, requiredLevel: r.requiredLevel, skill: r.skill ? { id: r.skill.id, name: r.skill.name, hashtag: r.skill.hashtag ?? `#${r.skill.name.replace(/\s+/g, "")}` } : null, certification: r.certificationTemplate ? { id: r.certificationTemplate.id, name: r.certificationTemplate.name } : null, label: r.requiredLevel === "CERTIFIED" ? `${r.certificationTemplate?.name ?? "Certification"} (certified)` : `${r.skill?.hashtag ?? r.skill?.name ?? ""} (${r.requiredLevel.toLowerCase()})` };
}
export type RequirementView = ReturnType<typeof toRequirementView>;
