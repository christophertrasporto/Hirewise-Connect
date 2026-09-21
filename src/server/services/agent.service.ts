import { z } from "zod";
import type { PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import type { RequestMeta } from "@/server/auth/session";
import { authorize, NotFoundError } from "@/server/policies/authorize";
import { assertAgentOwns } from "@/server/policies/ownership";
import { agentRepository } from "@/server/repositories/agent.repository";
import { taxonomyRepository } from "@/server/repositories/taxonomy.repository";
import { userRepository } from "@/server/repositories/user.repository";
import { hashPassword, passwordSchema } from "@/server/auth/password";
import { emailSchema, requestEmailVerification } from "./auth.service";
import { createSession } from "@/server/auth/session";
import { audit } from "@/server/audit/audit";
import { publishEvent } from "@/server/events/outbox";
import { rateLimit } from "@/server/auth/rate-limit";
import { toAgentSelfView, toAgentStaffListView, type AgentSelfView } from "@/server/views/agent.views";
import { assertTransitionAllowed, type AgentProfileStatus } from "@/server/state/agent-profile";
import { RegistrationError } from "./client.service";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

export const agentRegistrationSchema = z.object({
  fullName: z.string().trim().min(2, "Full name is required.").max(120),
  displayName: z.string().trim().min(2, "Professional name is required.").max(60),
  email: emailSchema,
  password: passwordSchema,
  phone: optionalText(40),
  locationCity: z.string().trim().min(2, "City is required.").max(80),
  locationCountry: z.string().trim().min(2, "Country is required.").max(80),
  timezone: z.string().trim().min(2, "Timezone is required.").max(80),
  primaryRole: z.string().trim().min(2, "Primary role is required.").max(80),
  yearsExperience: z.coerce.number().int().min(0).max(50),
});
export type AgentRegistrationInput = z.infer<typeof agentRegistrationSchema>;

export const personalSchema = z.object({
  displayName: z.string().trim().min(2).max(60),
  fullLegalName: z.string().trim().min(2).max(120),
  phone: optionalText(40),
  addressLine: optionalText(200),
  locationCity: z.string().trim().min(2).max(80),
  locationCountry: z.string().trim().min(2).max(80),
  timezone: z.string().trim().min(2).max(80),
  languages: z.array(z.string().trim().min(1).max(40)).min(1, "Add at least one language."),
  workSetup: z.enum(["REMOTE", "OFFICE", "HYBRID"]),
  preferredShift: optionalText(120),
  equipmentSummary: optionalText(500),
  internetSummary: optionalText(300),
});

export const professionalSchema = z.object({
  headline: z.string().trim().min(10, "Write a headline of at least 10 characters.").max(120),
  primaryRole: z.string().trim().min(2).max(80),
  summary: z.string().trim().min(80, "Write at least 80 characters so clients understand your background.").max(2000),
  yearsExperience: z.coerce.number().int().min(0).max(50),
  experienceLevel: z.enum(["ENTRY", "JUNIOR", "MID", "SENIOR", "LEAD"]),
  industries: z.array(z.object({ industry: z.string().trim().min(2).max(80), years: z.coerce.number().int().min(0).max(50) })).max(10),
});

export const skillsSchema = z.object({
  skills: z.array(z.object({ skillId: z.string().min(1), level: z.enum(["BASIC", "INTERMEDIATE", "ADVANCED", "EXPERT"]), yearsUsed: z.coerce.number().int().min(0).max(50).optional() })).min(3, "Add at least three skills.").max(25),
  software: z.array(z.object({ softwareId: z.string().min(1), level: z.enum(["BASIC", "INTERMEDIATE", "ADVANCED", "EXPERT"]) })).max(25),
});

export const experienceSchema = z.object({
  company: optionalText(120),
  title: z.string().trim().min(2).max(120),
  industry: optionalText(80),
  startDate: z.string().min(1, "Start date is required."),
  endDate: optionalText(20),
  description: optionalText(1500),
  isCampaign: z.coerce.boolean().default(false),
  campaignType: optionalText(80),
});

// ---------------------------------------------------------------------------
// Registration (Section 8.2)
// ---------------------------------------------------------------------------

export async function registerAgent(db: PrismaClient, input: AgentRegistrationInput, meta: RequestMeta) {
  rateLimit(`register:${meta.ipAddress ?? "unknown"}`, 10, 60 * 60_000);
  if (await userRepository.findByEmail(db, input.email)) throw new RegistrationError("An account with this email already exists.", "email");
  const passwordHash = await hashPassword(input.password);
  const role = await userRepository.roleIdByKey(db, "AGENT");

  const { userId, agentProfileId } = await db.$transaction(async (tx) => {
    const user = await userRepository.create(tx, { email: input.email, passwordHash, roleId: role.id });
    const profile = await agentRepository.createForUser(tx, {
      userId: user.id,
      displayName: input.displayName,
      fullLegalName: input.fullName,
      personalEmail: input.email,
      phone: input.phone || null,
      locationCity: input.locationCity,
      locationCountry: input.locationCountry,
      timezone: input.timezone,
      primaryRole: input.primaryRole,
      yearsExperience: input.yearsExperience,
    });
    const actor: Actor = { userId: user.id, role: "AGENT", permissions: new Set(), agentProfileId: profile.id };
    await audit(tx, { actor, action: "AGENT_REGISTERED", entityType: "AgentProfile", entityId: profile.id, newValue: { displayName: input.displayName, primaryRole: input.primaryRole }, ipAddress: meta.ipAddress ?? undefined });
    await publishEvent(tx, "USER_CREATED", { userId: user.id, role: "AGENT", email: input.email });
    await publishEvent(tx, "AGENT_REGISTERED", { agentProfileId: profile.id, userId: user.id, displayName: input.displayName, email: input.email });
    return { userId: user.id, agentProfileId: profile.id };
  });

  await requestEmailVerification(db, { userId, email: input.email, ...meta });
  const session = await createSession(db, { userId, mfaPassed: true, remember: true, ...meta });
  return { userId, agentProfileId, ...session };
}

// ---------------------------------------------------------------------------
// Own profile
// ---------------------------------------------------------------------------

async function loadOwn(db: PrismaClient, actor: Actor) {
  if (actor.role !== "AGENT" || !actor.agentProfileId) throw new NotFoundError();
  const p = await agentRepository.findSelf(db, actor.agentProfileId);
  assertAgentOwns(actor, p ? { agentProfileId: p.id } : null);
  return p!;
}

export async function getOwnProfile(db: PrismaClient, actor: Actor): Promise<AgentSelfView> {
  return toAgentSelfView(await loadOwn(db, actor));
}

/**
 * Section 8.2 step 3: weighted checklist. personal 15, professional 20, résumé 10,
 * skills 10, experience 10, video 20, voice 15.
 */
export function computeCompletion(v: AgentSelfView): { total: number; parts: Array<{ key: string; label: string; weight: number; done: boolean; href: string }> } {
  const parts = [
    { key: "personal", label: "Personal information", weight: 15, done: !!(v.privateContact?.fullLegalName && v.locationCity && v.timezone && v.languages.length && v.workSetup), href: "/profile/personal" },
    { key: "professional", label: "Professional information", weight: 20, done: !!(v.headline && v.summary && v.summary.length >= 80 && v.primaryRole && v.experienceLevel), href: "/profile/professional" },
    { key: "resume", label: "Résumé", weight: 10, done: !!v.privateContact?.hasResume, href: "/profile/resume" },
    { key: "skills", label: "Skills", weight: 10, done: v.skills.length >= 3, href: "/profile/skills" },
    { key: "experience", label: "Work experience", weight: 10, done: v.experiences.length >= 1, href: "/profile/experience" },
    { key: "video", label: "Video introduction", weight: 20, done: v.videos.some((x) => ["SUBMITTED", "UNDER_REVIEW", "APPROVED"].includes(x.status)), href: "/profile/media" },
    { key: "voice", label: "Voice sample", weight: 15, done: v.recordings.some((x) => ["SUBMITTED", "UNDER_REVIEW", "APPROVED"].includes(x.status)), href: "/profile/media" },
  ];
  const total = parts.reduce((sum, p) => sum + (p.done ? p.weight : 0), 0);
  return { total, parts };
}

async function recomputeCompletion(db: PrismaClient, agentProfileId: string) {
  const p = await agentRepository.findSelf(db, agentProfileId);
  if (!p) return 0;
  const { total } = computeCompletion(toAgentSelfView(p));
  await agentRepository.setCompletion(db, agentProfileId, total);
  return total;
}

export async function updatePersonal(db: PrismaClient, actor: Actor, input: z.infer<typeof personalSchema>) {
  const p = await loadOwn(db, actor);
  await agentRepository.updatePersonal(
    db,
    p.id,
    { displayName: input.displayName, locationCity: input.locationCity, locationCountry: input.locationCountry, timezone: input.timezone, languages: input.languages, workSetup: input.workSetup, preferredShift: input.preferredShift || null, equipmentSummary: input.equipmentSummary || null, internetSummary: input.internetSummary || null },
    { fullLegalName: input.fullLegalName, phone: input.phone || null, addressLine: input.addressLine || null },
  );
  return recomputeCompletion(db, p.id);
}

export async function updateProfessional(db: PrismaClient, actor: Actor, input: z.infer<typeof professionalSchema>) {
  const p = await loadOwn(db, actor);
  await agentRepository.updateProfessional(db, p.id, { headline: input.headline, primaryRole: input.primaryRole, summary: input.summary, yearsExperience: input.yearsExperience, experienceLevel: input.experienceLevel });
  await agentRepository.replaceIndustries(db, p.id, input.industries);
  return recomputeCompletion(db, p.id);
}

export async function updateSkills(db: PrismaClient, actor: Actor, input: z.infer<typeof skillsSchema>) {
  const p = await loadOwn(db, actor);
  const validSkills = new Set((await taxonomyRepository.skillIdsExist(db, input.skills.map((s) => s.skillId))).map((s) => s.id));
  const validSoftware = new Set((await taxonomyRepository.softwareIdsExist(db, input.software.map((s) => s.softwareId))).map((s) => s.id));
  await agentRepository.replaceSkills(db, p.id, input.skills.filter((s) => validSkills.has(s.skillId)).map((s) => ({ skillId: s.skillId, level: s.level, yearsUsed: s.yearsUsed ?? null })));
  await agentRepository.replaceSoftware(db, p.id, input.software.filter((s) => validSoftware.has(s.softwareId)));
  return recomputeCompletion(db, p.id);
}

export async function addExperience(db: PrismaClient, actor: Actor, input: z.infer<typeof experienceSchema>) {
  const p = await loadOwn(db, actor);
  await agentRepository.addExperience(db, p.id, {
    company: input.company || null,
    title: input.title,
    industry: input.industry || null,
    startDate: new Date(input.startDate),
    endDate: input.endDate ? new Date(input.endDate) : null,
    description: input.description || null,
    isCampaign: input.isCampaign,
    campaignType: input.campaignType || null,
  });
  return recomputeCompletion(db, p.id);
}

export async function removeExperience(db: PrismaClient, actor: Actor, experienceId: string) {
  const p = await loadOwn(db, actor);
  await agentRepository.removeExperience(db, p.id, experienceId);
  return recomputeCompletion(db, p.id);
}

export async function setResume(db: PrismaClient, actor: Actor, storageKey: string) {
  const p = await loadOwn(db, actor);
  await agentRepository.setResumeKey(db, p.id, storageKey);
  return recomputeCompletion(db, p.id);
}

export class SubmissionBlockedError extends Error {
  readonly status = 422;
  constructor(readonly missing: string[]) {
    super(`Profile is not ready to submit: ${missing.join(", ")}`);
    this.name = "SubmissionBlockedError";
  }
}

/**
 * DRAFT | REVISION_REQUIRED → SUBMITTED. Guard from Section 5.1: completion ≥ 80,
 * résumé uploaded, at least one video submitted or approved.
 */
export async function submitForReview(db: PrismaClient, actor: Actor) {
  const p = await loadOwn(db, actor);
  const view = toAgentSelfView(p);
  const { total, parts } = computeCompletion(view);
  const missing: string[] = [];
  if (total < 80) missing.push(`profile completion is ${total}% (need 80%)`);
  if (!view.privateContact?.hasResume) missing.push("résumé");
  if (!parts.find((x) => x.key === "video")?.done) missing.push("video introduction");
  if (missing.length) throw new SubmissionBlockedError(missing);
  assertTransitionAllowed(actor, p.id, p.status as AgentProfileStatus, "SUBMITTED");
  await db.$transaction(async (tx) => {
    await agentRepository.setStatus(tx, p.id, "SUBMITTED", { submittedAt: new Date() });
    await audit(tx, { actor, action: "PROFILE_SUBMITTED", entityType: "AgentProfile", entityId: p.id, previousValue: { status: p.status }, newValue: { status: "SUBMITTED", completion: total } });
    await publishEvent(tx, "PROFILE_SUBMITTED", { agentProfileId: p.id, userId: actor.userId, displayName: p.displayName });
  });
}

// ---------------------------------------------------------------------------
// Staff review (Section 5.1)
// ---------------------------------------------------------------------------

export async function listAgentsForStaff(db: PrismaClient, actor: Actor, status?: AgentProfileStatus) {
  authorize(actor, "agent.read_public");
  const rows = await agentRepository.listByStatus(db, status);
  // Login email is contact information: only with agent.read_private_contact (Section 6, footnote 1).
  const canContact = actor.permissions.has("agent.read_private_contact");
  return rows.map((r) => ({ ...toAgentStaffListView(r), email: canContact ? r.user.email : null }));
}

export async function getAgentForStaff(db: PrismaClient, actor: Actor, agentProfileId: string) {
  authorize(actor, "agent.read_public");
  const p = await agentRepository.findByIdForStaff(db, agentProfileId);
  if (!p) throw new NotFoundError();
  const view = toAgentSelfView(p);
  // Private contact only with the dedicated permission (INV-P1).
  if (!actor.permissions.has("agent.read_private_contact")) view.privateContact = null;
  return { ...view, email: actor.permissions.has("agent.read_private_contact") ? p.user.email : null };
}

export async function reviewTransition(db: PrismaClient, actor: Actor, agentProfileId: string, to: "UNDER_REVIEW" | "APPROVED" | "REVISION_REQUIRED" | "REJECTED" | "HIDDEN" | "SUSPENDED", reason?: string) {
  const p = await agentRepository.findByIdForStaff(db, agentProfileId);
  if (!p) throw new NotFoundError();
  assertTransitionAllowed(actor, p.id, p.status as AgentProfileStatus, to, reason);
  const actionByTarget = { UNDER_REVIEW: "PROFILE_UNDER_REVIEW", APPROVED: "PROFILE_APPROVED", REVISION_REQUIRED: "PROFILE_REVISION_REQUIRED", REJECTED: "PROFILE_REJECTED", HIDDEN: "PROFILE_HIDDEN", SUSPENDED: "PROFILE_SUSPENDED" } as const;
  await db.$transaction(async (tx) => {
    const extra = to === "APPROVED" ? { approvedAt: new Date(), approvedById: actor.userId, hiddenAt: null, suspendedAt: null } : to === "HIDDEN" ? { hiddenAt: new Date() } : to === "SUSPENDED" ? { suspendedAt: new Date() } : {};
    await agentRepository.setStatus(tx, p.id, to, extra);
    if (to === "APPROVED" && p.availabilityStatus === "UNAVAILABLE") {
      await agentRepository.setAvailability(tx, p.id, "AVAILABLE", { setById: actor.userId, reason: "Profile approved" });
    }
    await audit(tx, { actor, action: actionByTarget[to], entityType: "AgentProfile", entityId: p.id, previousValue: { status: p.status }, newValue: { status: to }, reason });
    if (to === "APPROVED" || to === "REVISION_REQUIRED" || to === "REJECTED") {
      await publishEvent(tx, "PROFILE_REVIEWED", { agentProfileId: p.id, userId: p.userId, displayName: p.displayName, email: p.user.email, outcome: to, feedback: reason ?? null });
    }
  });
}
