import { z } from "zod";
import type { Db, PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorize, ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { assertCoachAssigned } from "@/server/policies/ownership";
import { skillsRepository } from "@/server/repositories/skills.repository";
import { academyRepository } from "@/server/repositories/academy.repository";
import { audit } from "@/server/audit/audit";
import { publishEvent } from "@/server/events/outbox";
import { recomputeForSkill, recomputeForCourse } from "@/server/services/skill-verification.service";
import { toSkillTagView, toPathwayView, toSkillTagRequestView, toRequirementView } from "@/server/views/skills.views";

/**
 * Skills system (docs/plan-skills-tags.md): the curated tag list, how each tag is verified, pathways, tag requests,
 * course-to-tag mapping, and opportunity requirements. Verification itself lives in skill-verification.service and is
 * never written here.
 */

export function slugify(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
export function hashtagFor(name: string) {
  return "#" + name.trim().replace(/[^A-Za-z0-9]+/g, " ").split(" ").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join("");
}

// ---------------------------------------------------------------------------
// Tags (skills.manage)
// ---------------------------------------------------------------------------

export const skillTagSchema = z.object({
  id: z.string().optional().or(z.literal("")),
  name: z.string().trim().min(2, "Name the tag.").max(60),
  category: z.string().trim().min(2).max(60),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  isActive: z.coerce.boolean().default(true),
  verificationMode: z.enum(["NONE", "ANY_COURSE", "REQUIRED_COURSE", "PATHWAY"]).default("NONE"),
  requiredCourseId: z.string().optional().or(z.literal("")),
  requiredPathwayId: z.string().optional().or(z.literal("")),
  minAssessmentScore: z.coerce.number().int().min(0).max(100).default(80),
});

export async function listSkillTags(db: PrismaClient, actor: Actor, activeOnly = false) {
  authorize(actor, "skills.manage");
  return (await skillsRepository.listTags(db, activeOnly)).map(toSkillTagView);
}

export async function saveSkillTag(db: PrismaClient, actor: Actor, raw: z.input<typeof skillTagSchema>) {
  authorize(actor, "skills.manage");
  const input = skillTagSchema.parse(raw);
  if (input.verificationMode === "REQUIRED_COURSE" && !input.requiredCourseId) throw new Error("Choose the required course.");
  if (input.verificationMode === "PATHWAY" && !input.requiredPathwayId) throw new Error("Choose the pathway.");
  const slug = slugify(input.name);
  const hashtag = hashtagFor(input.name);
  const existingSlug = await skillsRepository.findTagBySlug(db, slug);
  if (existingSlug && existingSlug.id !== input.id) throw new Error(`A tag with the slug "${slug}" already exists (${existingSlug.name}).`);
  const data = { name: input.name, category: input.category, slug, hashtag, description: input.description || null, isActive: input.isActive, verificationMode: input.verificationMode, requiredCourseId: input.verificationMode === "REQUIRED_COURSE" ? input.requiredCourseId || null : null, requiredPathwayId: input.verificationMode === "PATHWAY" ? input.requiredPathwayId || null : null, minAssessmentScore: input.minAssessmentScore };
  const saved = await db.$transaction(async (tx) => {
    const before = input.id ? await skillsRepository.findTag(tx, input.id) : null;
    if (input.id && !before) throw new NotFoundError();
    const row = before ? await skillsRepository.updateTag(tx, before.id, data) : await skillsRepository.createTag(tx, data).then((t) => skillsRepository.updateTag(tx, t.id, data));
    await audit(tx, { actor, action: before ? "SKILL_TAG_UPDATED" : "SKILL_TAG_CREATED", entityType: "Skill", entityId: row.id, previousValue: before ? { verificationMode: before.verificationMode, requiredCourseId: before.requiredCourseId, requiredPathwayId: before.requiredPathwayId, minAssessmentScore: before.minAssessmentScore, isActive: before.isActive } : undefined, newValue: data });
    return row;
  });
  // Configuration changed: every holder is re-evaluated (never set by hand; derived).
  await recomputeForSkill(db, saved.id);
  return toSkillTagView(saved);
}

// ---------------------------------------------------------------------------
// Course mapping (course ownership) and pathways (skills.manage)
// ---------------------------------------------------------------------------

export async function setCourseSkillTags(db: PrismaClient, actor: Actor, courseId: string, skillIds: string[]) {
  const course = await academyRepository.findCourse(db, courseId);
  if (!course) throw new NotFoundError();
  assertCoachAssigned(actor, course.id);
  const unique = [...new Set(skillIds)];
  const valid = new Set((await skillsRepository.listTags(db, true)).map((t) => t.id));
  const ids = unique.filter((id) => valid.has(id));
  await db.$transaction(async (tx) => {
    await skillsRepository.setCourseTags(tx, course.id, ids);
    await audit(tx, { actor, action: "COURSE_SKILL_TAGS_SET", entityType: "AcademyCourse", entityId: course.id, newValue: { skillIds: ids } });
  });
  await recomputeForCourse(db, course.id);
  return ids;
}

export async function courseSkillTags(db: PrismaClient, actor: Actor, courseId: string) {
  const course = await academyRepository.findCourse(db, courseId);
  if (!course) throw new NotFoundError();
  assertCoachAssigned(actor, course.id, "course.read_assigned");
  return (await skillsRepository.courseTags(db, course.id)).map((t) => ({ id: t.skill.id, name: t.skill.name, hashtag: t.skill.hashtag }));
}

export const pathwaySchema = z.object({
  id: z.string().optional().or(z.literal("")),
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().max(1000).optional().or(z.literal("")),
  isActive: z.coerce.boolean().default(true),
  courses: z.array(z.object({ courseId: z.string().min(1), isRequired: z.coerce.boolean().default(true) })).default([]),
});

export async function listPathways(db: PrismaClient, actor: Actor) {
  authorize(actor, "skills.manage");
  return (await skillsRepository.listPathways(db)).map(toPathwayView);
}

export async function savePathway(db: PrismaClient, actor: Actor, raw: z.input<typeof pathwaySchema>) {
  authorize(actor, "skills.manage");
  const input = pathwaySchema.parse(raw);
  const row = await db.$transaction(async (tx) => {
    const p = await skillsRepository.upsertPathway(tx, { id: input.id || undefined, title: input.title, slug: slugify(input.title), description: input.description || null, isActive: input.isActive });
    const seen = new Set<string>();
    const items = input.courses.filter((c) => (seen.has(c.courseId) ? false : seen.add(c.courseId))).map((c, i) => ({ courseId: c.courseId, sortOrder: i, isRequired: c.isRequired }));
    await skillsRepository.setPathwayCourses(tx, p.id, items);
    await audit(tx, { actor, action: input.id ? "SKILL_PATHWAY_UPDATED" : "SKILL_PATHWAY_CREATED", entityType: "SkillPathway", entityId: p.id, newValue: { title: input.title, courses: items } });
    return p;
  });
  for (const c of row.courses) await recomputeForCourse(db, c.courseId);
  return toPathwayView((await skillsRepository.findPathway(db, row.id))!);
}

// ---------------------------------------------------------------------------
// Tag requests (agents request, skills.manage decides)
// ---------------------------------------------------------------------------

export async function requestSkillTag(db: PrismaClient, actor: Actor, text: string) {
  if (actor.role !== "AGENT") throw new ForbiddenError("Only talent request tags");
  const clean = text.trim().replace(/^#/, "");
  if (clean.length < 2 || clean.length > 60) throw new Error("Describe the tag in 2 to 60 characters.");
  const existing = await skillsRepository.findTagBySlug(db, slugify(clean));
  if (existing) throw new Error(`${existing.hashtag ?? existing.name} already exists; add it from the list.`);
  const r = await db.$transaction(async (tx) => {
    const row = await skillsRepository.createRequest(tx, { text: clean, requestedById: actor.userId });
    await audit(tx, { actor, action: "SKILL_TAG_REQUESTED", entityType: "SkillTagRequest", entityId: row.id, newValue: { text: clean } });
    await publishEvent(tx, "SKILL_TAG_REQUESTED", { requestId: row.id, text: clean, requesterUserId: actor.userId });
    return row;
  });
  return toSkillTagRequestView(r);
}

export async function myTagRequests(db: PrismaClient, actor: Actor) {
  return (await skillsRepository.listRequests(db)).filter((r) => r.requestedById === actor.userId).map(toSkillTagRequestView);
}

export async function listTagRequests(db: PrismaClient, actor: Actor, status?: "OPEN" | "APPROVED" | "MERGED" | "REJECTED") {
  authorize(actor, "skills.manage");
  return (await skillsRepository.listRequests(db, status)).map(toSkillTagRequestView);
}

export const tagDecisionSchema = z.object({
  requestId: z.string().min(1),
  decision: z.enum(["APPROVE", "MERGE", "REJECT"]),
  category: z.string().trim().max(60).optional().or(z.literal("")),
  mergeIntoSkillId: z.string().optional().or(z.literal("")),
  note: z.string().trim().max(500).optional().or(z.literal("")),
});

export async function decideTagRequest(db: PrismaClient, actor: Actor, raw: z.input<typeof tagDecisionSchema>) {
  authorize(actor, "skills.manage");
  const input = tagDecisionSchema.parse(raw);
  const r = await skillsRepository.findRequest(db, input.requestId);
  if (!r) throw new NotFoundError();
  if (r.status !== "OPEN") throw new Error("This request was already decided.");
  const note = input.note?.trim() || null;
  const decided = await db.$transaction(async (tx) => {
    if (input.decision === "APPROVE") {
      const name = r.text.replace(/\b\w/g, (c) => c.toUpperCase());
      const slug = slugify(name);
      if (await skillsRepository.findTagBySlug(tx, slug)) throw new Error("A tag with that name already exists; merge instead.");
      const tag = await skillsRepository.createTag(tx, { name, category: input.category || "Other", slug, hashtag: hashtagFor(name), description: null });
      await audit(tx, { actor, action: "SKILL_TAG_CREATED", entityType: "Skill", entityId: tag.id, newValue: { name, fromRequest: r.id } });
      const u = await skillsRepository.decideRequest(tx, r.id, { status: "APPROVED", decidedById: actor.userId, note, createdSkillId: tag.id });
      await tx.agentSkill.upsert({ where: { agentProfileId_skillId: { agentProfileId: (await requesterProfileId(tx, r.requestedById)) ?? "", skillId: tag.id } }, create: { agentProfileId: (await requesterProfileId(tx, r.requestedById)) ?? "", skillId: tag.id }, update: {} }).catch(() => null);
      return u;
    }
    if (input.decision === "MERGE") {
      if (!input.mergeIntoSkillId) throw new Error("Choose the tag to merge into.");
      const target = await skillsRepository.findTag(tx, input.mergeIntoSkillId);
      if (!target) throw new NotFoundError();
      const pid = await requesterProfileId(tx, r.requestedById);
      if (pid) await tx.agentSkill.upsert({ where: { agentProfileId_skillId: { agentProfileId: pid, skillId: target.id } }, create: { agentProfileId: pid, skillId: target.id }, update: {} });
      return skillsRepository.decideRequest(tx, r.id, { status: "MERGED", decidedById: actor.userId, note, mergedIntoSkillId: target.id });
    }
    if (!note) throw new Error("A note is required to reject.");
    return skillsRepository.decideRequest(tx, r.id, { status: "REJECTED", decidedById: actor.userId, note });
  });
  await audit(db, { actor, action: "SKILL_TAG_REQUEST_DECIDED", entityType: "SkillTagRequest", entityId: r.id, newValue: { decision: input.decision, mergeIntoSkillId: input.mergeIntoSkillId || null }, reason: note ?? undefined });
  await publishEvent(db, "SKILL_TAG_REQUEST_DECIDED", { requestId: r.id, text: r.text, requesterUserId: r.requestedById, decision: input.decision, note });
  return toSkillTagRequestView(decided);
}

async function requesterProfileId(db: Db, userId: string) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { agentProfiles: { where: { archivedAt: null }, select: { id: true }, take: 1 } } });
  return u?.agentProfiles[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// Opportunity requirements (opportunity.manage) and eligibility
// ---------------------------------------------------------------------------

export const requirementsSchema = z.object({
  opportunityId: z.string().min(1),
  items: z.array(z.object({ skillId: z.string().optional().or(z.literal("")), certificationTemplateId: z.string().optional().or(z.literal("")), requiredLevel: z.enum(["DECLARED", "VERIFIED", "CERTIFIED"]) })).max(30),
});

export async function setOpportunityRequirements(db: PrismaClient, actor: Actor, raw: z.input<typeof requirementsSchema>) {
  authorize(actor, "opportunity.manage");
  const input = requirementsSchema.parse(raw);
  const items = input.items
    .map((i) => ({ skillId: i.skillId || null, certificationTemplateId: i.certificationTemplateId || null, requiredLevel: i.requiredLevel }))
    .filter((i) => (i.requiredLevel === "CERTIFIED" ? !!i.certificationTemplateId : !!i.skillId));
  await db.$transaction(async (tx) => {
    await skillsRepository.setRequirements(tx, input.opportunityId, items);
    await audit(tx, { actor, action: "OPPORTUNITY_REQUIREMENTS_SET", entityType: "Opportunity", entityId: input.opportunityId, newValue: { items } });
  });
  return (await skillsRepository.requirementsFor(db, input.opportunityId)).map(toRequirementView);
}

/** Section 7 of the spec: every requirement must pass. Returns the unmet ones (empty = eligible). */
export async function unmetRequirements(db: Db, agentProfileId: string, opportunityId: string): Promise<string[]> {
  const [reqs, holdings] = await Promise.all([skillsRepository.requirementsFor(db, opportunityId), skillsRepository.candidateHoldings(db, agentProfileId)]);
  if (!reqs.length) return [];
  const declared = new Set(holdings?.skills.map((s) => s.skillId) ?? []);
  const verified = new Set(holdings?.skills.filter((s) => s.verifiedAt).map((s) => s.skillId) ?? []);
  const certified = new Set(holdings?.certifications.map((c) => c.templateId) ?? []);
  const unmet: string[] = [];
  for (const r of reqs) {
    const tag = r.skill?.hashtag ?? r.skill?.name ?? "";
    if (r.requiredLevel === "DECLARED" && r.skillId && !declared.has(r.skillId)) unmet.push(`${tag} not declared`);
    if (r.requiredLevel === "VERIFIED" && r.skillId && !verified.has(r.skillId)) unmet.push(`${tag} not verified`);
    if (r.requiredLevel === "CERTIFIED" && r.certificationTemplateId && !certified.has(r.certificationTemplateId)) unmet.push(`${r.certificationTemplate?.name ?? "certification"} missing`);
  }
  return unmet;
}

/** Declared-level requirements seeded from a requirement's skills at publish time. */
export async function seedRequirementsFromSkills(db: Db, opportunityId: string, skills: string[]) {
  if (!skills.length) return;
  const found = await skillsRepository.skillsByNames(db, skills);
  if (!found.length) return;
  await skillsRepository.setRequirements(db, opportunityId, found.map((s) => ({ skillId: s.id, certificationTemplateId: null, requiredLevel: "DECLARED" as const })));
}

export async function opportunityRequirements(db: Db, opportunityId: string) {
  return (await skillsRepository.requirementsFor(db, opportunityId)).map(toRequirementView);
}
