import type { Prisma, SkillVerificationMode, RequirementLevel, SkillTagRequestStatus } from "@prisma/client";
import type { Db } from "@/server/db/types";

/** Skills system: tags, course mapping, pathways, requests, requirements, and the facts verification needs. */

export const skillTagInclude = {
  requiredCourse: { select: { id: true, title: true, status: true } },
  requiredPathway: { select: { id: true, title: true, slug: true } },
  courses: { select: { courseId: true, course: { select: { id: true, title: true, status: true } } } },
  _count: { select: { agents: true } },
} satisfies Prisma.SkillInclude;
export type SkillTagRecord = Prisma.SkillGetPayload<{ include: typeof skillTagInclude }>;

export const pathwayInclude = {
  courses: { orderBy: { sortOrder: "asc" as const }, select: { courseId: true, sortOrder: true, isRequired: true, course: { select: { id: true, title: true, status: true } } } },
  _count: { select: { skills: true } },
} satisfies Prisma.SkillPathwayInclude;
export type PathwayRecord = Prisma.SkillPathwayGetPayload<{ include: typeof pathwayInclude }>;

export const requestInclude = { requestedBy: { select: { id: true, email: true, role: { select: { key: true } } } }, mergedInto: { select: { id: true, name: true } }, createdSkill: { select: { id: true, name: true } } } satisfies Prisma.SkillTagRequestInclude;
export type SkillTagRequestRecord = Prisma.SkillTagRequestGetPayload<{ include: typeof requestInclude }>;

export const skillsRepository = {
  // ---------------------------------------------------------------- tags
  listTags(db: Db, activeOnly = true) {
    return db.skill.findMany({ where: activeOnly ? { isActive: true } : {}, include: skillTagInclude, orderBy: [{ category: "asc" }, { name: "asc" }] });
  },
  findTag(db: Db, id: string) {
    return db.skill.findUnique({ where: { id }, include: skillTagInclude });
  },
  findTagBySlug(db: Db, slug: string) {
    return db.skill.findUnique({ where: { slug }, include: skillTagInclude });
  },
  createTag(db: Db, d: { name: string; category: string; slug: string; hashtag: string; description: string | null }) {
    return db.skill.create({ data: d, include: skillTagInclude });
  },
  updateTag(db: Db, id: string, d: { name?: string; category?: string; slug?: string; hashtag?: string; description?: string | null; isActive?: boolean; verificationMode?: SkillVerificationMode; requiredCourseId?: string | null; requiredPathwayId?: string | null; minAssessmentScore?: number }) {
    return db.skill.update({ where: { id }, data: d, include: skillTagInclude });
  },

  // ---------------------------------------------------------------- course mapping
  async setCourseTags(db: Db, courseId: string, skillIds: string[]) {
    await db.courseSkillTag.deleteMany({ where: { courseId, skillId: { notIn: skillIds } } });
    for (const skillId of skillIds) await db.courseSkillTag.upsert({ where: { courseId_skillId: { courseId, skillId } }, create: { courseId, skillId }, update: {} });
  },
  courseTags(db: Db, courseId: string) {
    return db.courseSkillTag.findMany({ where: { courseId }, select: { skillId: true, skill: { select: { id: true, name: true, hashtag: true } } } });
  },

  // ---------------------------------------------------------------- pathways
  listPathways(db: Db) {
    return db.skillPathway.findMany({ include: pathwayInclude, orderBy: { title: "asc" } });
  },
  findPathway(db: Db, id: string) {
    return db.skillPathway.findUnique({ where: { id }, include: pathwayInclude });
  },
  upsertPathway(db: Db, d: { id?: string; title: string; slug: string; description: string | null; isActive: boolean }) {
    return d.id ? db.skillPathway.update({ where: { id: d.id }, data: { title: d.title, slug: d.slug, description: d.description, isActive: d.isActive }, include: pathwayInclude }) : db.skillPathway.create({ data: { title: d.title, slug: d.slug, description: d.description, isActive: d.isActive }, include: pathwayInclude });
  },
  async setPathwayCourses(db: Db, pathwayId: string, items: Array<{ courseId: string; sortOrder: number; isRequired: boolean }>) {
    await db.pathwayCourse.deleteMany({ where: { pathwayId } });
    if (items.length) await db.pathwayCourse.createMany({ data: items.map((i) => ({ pathwayId, ...i })) });
  },

  // ---------------------------------------------------------------- requests
  createRequest(db: Db, d: { text: string; requestedById: string }) {
    return db.skillTagRequest.create({ data: d, include: requestInclude });
  },
  findRequest(db: Db, id: string) {
    return db.skillTagRequest.findUnique({ where: { id }, include: requestInclude });
  },
  listRequests(db: Db, status?: SkillTagRequestStatus) {
    return db.skillTagRequest.findMany({ where: status ? { status } : {}, include: requestInclude, orderBy: { createdAt: "asc" } });
  },
  decideRequest(db: Db, id: string, d: { status: SkillTagRequestStatus; decidedById: string; note: string | null; mergedIntoSkillId?: string | null; createdSkillId?: string | null }) {
    return db.skillTagRequest.update({ where: { id }, data: { status: d.status, decidedById: d.decidedById, decidedAt: new Date(), note: d.note, mergedIntoSkillId: d.mergedIntoSkillId ?? null, createdSkillId: d.createdSkillId ?? null }, include: requestInclude });
  },
  countOpenRequests(db: Db) {
    return db.skillTagRequest.count({ where: { status: "OPEN" } });
  },

  // ---------------------------------------------------------------- agent tags
  async replaceDeclaredTags(db: Db, agentProfileId: string, skillIds: string[]) {
    await db.agentSkill.deleteMany({ where: { agentProfileId, skillId: { notIn: skillIds } } });
    const existing = new Set((await db.agentSkill.findMany({ where: { agentProfileId }, select: { skillId: true } })).map((s) => s.skillId));
    const fresh = skillIds.filter((id) => !existing.has(id));
    if (fresh.length) await db.agentSkill.createMany({ data: fresh.map((skillId) => ({ agentProfileId, skillId })) });
  },
  /** The only write path for verification. */
  setVerification(db: Db, agentProfileId: string, skillId: string, d: { verifiedAt: Date | null; verifiedVia: string | null }) {
    return db.agentSkill.update({ where: { agentProfileId_skillId: { agentProfileId, skillId } }, data: d, select: { skillId: true, verifiedAt: true } });
  },

  // ---------------------------------------------------------------- verification facts
  declaredTagsWithConfig(db: Db, agentProfileId: string) {
    return db.agentSkill.findMany({ where: { agentProfileId }, select: { skillId: true, verifiedAt: true, verifiedVia: true, skill: { select: { id: true, verificationMode: true, requiredCourseId: true, requiredPathwayId: true, minAssessmentScore: true, courses: { select: { courseId: true } }, requiredPathway: { select: { courses: { where: { isRequired: true }, select: { courseId: true } } } }, certificationTemplates: { select: { id: true } } } } } });
  },
  /** Every certification the agent has had, by template, for the linked-certification rule. */
  certificationStatuses(db: Db, agentProfileId: string) {
    return db.certification.findMany({ where: { agentProfileId }, select: { templateId: true, status: true } });
  },
  /** Passing completions on non-revoked enrollments: course id, exam score, and whether the course has an exam. */
  passingCompletions(db: Db, agentProfileId: string) {
    return db.courseEnrollment.findMany({ where: { agentProfileId, status: { not: "REVOKED" }, accessRevokedAt: null, completion: { isNot: null } }, select: { courseId: true, completion: { select: { examScore: true } }, course: { select: { exam: { select: { id: true } } } } } });
  },
  agentsHoldingTag(db: Db, skillId: string) {
    return db.agentSkill.findMany({ where: { skillId }, select: { agentProfileId: true } });
  },
  agentsHoldingAnyTag(db: Db) {
    return db.agentSkill.findMany({ where: { skill: { verificationMode: { not: "NONE" } } }, select: { agentProfileId: true }, distinct: ["agentProfileId"] });
  },
  agentsCompletedCourse(db: Db, courseId: string) {
    return db.courseEnrollment.findMany({ where: { courseId, completion: { isNot: null } }, select: { agentProfileId: true } });
  },

  // ---------------------------------------------------------------- opportunity requirements
  requirementsFor(db: Db, opportunityId: string) {
    return db.opportunityRequirement.findMany({ where: { opportunityId }, include: { skill: { select: { id: true, name: true, hashtag: true } }, certificationTemplate: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } });
  },
  async setRequirements(db: Db, opportunityId: string, items: Array<{ skillId: string | null; certificationTemplateId: string | null; requiredLevel: RequirementLevel }>) {
    await db.opportunityRequirement.deleteMany({ where: { opportunityId } });
    if (items.length) await db.opportunityRequirement.createMany({ data: items.map((i) => ({ opportunityId, ...i })) });
  },
  /** What a candidate holds: declared and verified tags, approved certification templates. */
  candidateHoldings(db: Db, agentProfileId: string) {
    return db.agentProfile.findUnique({ where: { id: agentProfileId }, select: { skills: { select: { skillId: true, verifiedAt: true } }, certifications: { where: { status: "APPROVED" }, select: { templateId: true } } } });
  },
  skillsByNames(db: Db, names: string[]) {
    return db.skill.findMany({ where: { OR: [{ id: { in: names } }, { name: { in: names, mode: "insensitive" } }] }, select: { id: true, name: true } });
  },
};
