import { z } from "zod";
import type { PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorize, NotFoundError } from "@/server/policies/authorize";
import { assertClientOwns } from "@/server/policies/ownership";
import { requirementRepository } from "@/server/repositories/requirement.repository";
import { audit } from "@/server/audit/audit";
import { assertMarketplaceAccess } from "./search.service";

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

export const requirementSchema = z.object({
  title: z.string().trim().min(3, "Give the requirement a title.").max(120),
  role: z.string().trim().min(2, "Role is required.").max(80),
  jobDescription: optionalText(4000),
  skills: z.array(z.string().trim().min(1)).max(20).default([]),
  industry: optionalText(80),
  experienceLevel: z.enum(["ENTRY", "JUNIOR", "MID", "SENIOR", "LEAD"]).optional().or(z.literal("")),
  agentsRequired: z.coerce.number().int().min(1).max(500).default(1),
  schedule: optionalText(200),
  timezone: optionalText(80),
  software: z.array(z.string().trim().min(1)).max(20).default([]),
  startDate: optionalText(20),
  budgetMin: optionalText(12),
  budgetMax: optionalText(12),
  otherRequirements: optionalText(2000),
});
export type RequirementInput = z.infer<typeof requirementSchema>;

/** Section "Client requirement / job request". Budget is optional and stored in minor units (INV-I4). */
export async function createRequirement(db: PrismaClient, actor: Actor, input: RequirementInput) {
  const access = await assertMarketplaceAccess(db, actor);
  if (!access.clientId) throw new NotFoundError();
  const toMinor = (v?: string) => (v ? Math.round(Number(v) * 100) : null);
  const req = await requirementRepository.create(db, {
    clientId: access.clientId,
    title: input.title,
    role: input.role,
    jobDescription: input.jobDescription || null,
    skills: input.skills,
    industry: input.industry || null,
    experienceLevel: input.experienceLevel || null,
    agentsRequired: input.agentsRequired,
    schedule: input.schedule || null,
    timezone: input.timezone || null,
    software: input.software,
    startDate: input.startDate ? new Date(input.startDate) : null,
    budgetMin: Number.isFinite(Number(input.budgetMin)) ? toMinor(input.budgetMin) : null,
    budgetMax: Number.isFinite(Number(input.budgetMax)) ? toMinor(input.budgetMax) : null,
    currency: input.budgetMin || input.budgetMax ? "USD" : null,
    otherRequirements: input.otherRequirements || null,
  });
  await audit(db, { actor, action: "REQUIREMENT_CREATED", entityType: "ClientRequirement", entityId: req.id, newValue: { title: input.title, role: input.role, agentsRequired: input.agentsRequired } });
  return req.id;
}

export async function listOwnRequirements(db: PrismaClient, actor: Actor) {
  if (actor.role !== "CLIENT" || !actor.clientId) return [];
  const rows = await requirementRepository.listForClient(db, actor.clientId);
  return rows.map((r) => ({ id: r.id, title: r.title, role: r.role, agentsRequired: r.agentsRequired, schedule: r.schedule, startDate: r.startDate, status: r.status, createdAt: r.createdAt, skills: r.skills, software: r.software, industry: r.industry, experienceLevel: r.experienceLevel, jobDescription: r.jobDescription, otherRequirements: r.otherRequirements }));
}

export async function listRequirementsForStaff(db: PrismaClient, actor: Actor) {
  authorize(actor, "requirement.read");
  const rows = await requirementRepository.listForStaff(db);
  return rows.map((r) => ({ id: r.id, title: r.title, role: r.role, agentsRequired: r.agentsRequired, schedule: r.schedule, timezone: r.timezone, startDate: r.startDate, status: r.status, createdAt: r.createdAt, skills: r.skills, software: r.software, industry: r.industry, experienceLevel: r.experienceLevel, budgetMin: r.budgetMin, budgetMax: r.budgetMax, currency: r.currency, client: { id: r.client.id, companyName: r.client.companyName, managed: r.client.accountManagerUserId === actor.userId } }));
}

export async function closeRequirement(db: PrismaClient, actor: Actor, id: string) {
  const r = await requirementRepository.findById(db, id);
  assertClientOwns(actor, r, "requirement.manage");
  await requirementRepository.setStatus(db, id, "CLOSED");
}
