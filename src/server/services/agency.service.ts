import { z } from "zod";
import { joinAgencyTx, endMembershipTx, assignPlanTx } from "@/server/services/seat.service";
import { seatRepository } from "@/server/repositories/seat.repository";
import { membershipRepository } from "@/server/repositories/membership.repository";
import type { Db, PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorize, ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { assertAgencyScope, requireActiveAgency } from "@/server/policies/ownership";
import { agencyRepository } from "@/server/repositories/agency.repository";
import { userRepository } from "@/server/repositories/user.repository";
import { audit } from "@/server/audit/audit";
import { publishEvent } from "@/server/events/outbox";
import { assertAgencyStatusTransition, type AgencyStatus } from "@/server/state/agency-application";
import { toAgencyOwnerView, toAgencyStaffView } from "@/server/views/agency.views";

/**
 * Agencies (Agency A1). There are exactly two ways an Agency row comes to exist: approveApplication (which calls
 * createAgencyForApplication inside its transaction) and createAgencyDirect (agency.create_direct, Super Admin).
 * No server action or route exposes anything else.
 */
const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

type OwnerCandidate = { id: string; email: string; role: { key: string }; agentProfiles: Array<{ id: string; platformIdentityId: string | null }> };

/**
 * Shared by approval and direct creation. Runs inside the caller's transaction: creates the agency, the Owner
 * seat, switches an APPLICANT to AGENCY_OWNER (other roles keep their role; the seat grants the portal), and makes
 * an owner who is also talent a primary member of their own agency (decision D6).
 */
export async function provisionAgency(tx: Db, actor: Actor, owner: OwnerCandidate, d: { name: string; logoKey: string | null; description: string | null; contactEmail: string; contactPhone: string | null; country: string; city: string | null; website: string | null; source: "APPLICATION" | "DIRECT"; applicationId?: string; planKey?: string | null }) {
  const agency = await agencyRepository.createAgency(tx, { name: d.name, logoKey: d.logoKey, ownerUserId: owner.id, description: d.description, contactEmail: d.contactEmail, contactPhone: d.contactPhone, country: d.country, city: d.city, website: d.website });
  await agencyRepository.addSeat(tx, { agencyId: agency.id, userId: owner.id, role: "OWNER", permissions: [], addedById: actor.userId });
  await audit(tx, { actor, action: "AGENCY_CREATED", entityType: "Agency", entityId: agency.id, newValue: { name: d.name, ownerUserId: owner.id, source: d.source, applicationId: d.applicationId ?? null } });
  await audit(tx, { actor, action: "AGENCY_SEAT_ADDED", entityType: "AgencyUser", entityId: `${agency.id}:${owner.id}`, newValue: { agencyId: agency.id, userId: owner.id, role: "OWNER" } });
  if (owner.role.key === "APPLICANT") {
    const role = await userRepository.roleIdByKey(tx, "AGENCY_OWNER");
    await userRepository.setRole(tx, owner.id, role.id);
    await audit(tx, { actor, action: "USER_ROLE_CHANGED", entityType: "User", entityId: owner.id, previousValue: { role: "APPLICANT" }, newValue: { role: "AGENCY_OWNER", agencyId: agency.id } });
  }
  // v2 phase 2: the plan chosen at application (or given at direct creation) writes the base seats.
  const plan = d.planKey ? await seatRepository.planByKey(tx, d.planKey) : null;
  if (plan && plan.isActive) await assignPlanTx(tx, actor, { id: agency.id, name: d.name, planId: null, ownerUserId: owner.id, owner: { email: owner.email } }, plan, { reason: d.source === "APPLICATION" ? "Plan chosen at application, confirmed at approval" : "Plan set at direct creation", override: true });
  // An owner who is also talent becomes a member of their own agency (decision D6) and takes a seat (decision 4),
  // unless they already belong to another agency, which is left for Hirewise to resolve.
  const ownerProfile = owner.agentProfiles[0] ?? null;
  if (ownerProfile) {
    const elsewhere = await membershipRepository.openForProfile(tx, ownerProfile.id);
    if (!elsewhere) await joinAgencyTx(tx, actor, { agencyId: agency.id, agentProfileId: ownerProfile.id, platformIdentityId: ownerProfile.platformIdentityId, status: "ACTIVE", source: "OWNER", approvedById: actor.userId, allowOverCapacity: true, reason: "Owner's own talent profile" });
    else await audit(tx, { actor, action: "AGENCY_UPDATED", entityType: "Agency", entityId: agency.id, newValue: { note: "Owner already belongs to another agency; no owner membership created", membershipId: elsewhere.id } });
  }
  return agency.id;
}

/** Called only by approveApplication, inside its transaction. */
export async function createAgencyForApplication(tx: Db, actor: Actor, app: { id: string; applicant: OwnerCandidate; proposedAgencyName: string; proposedLogoKey: string | null; description: string; applicantEmail: string; applicantPhone: string | null; country: string; city: string | null; website: string | null; preferredPlanKey: string | null }) {
  authorize(actor, "agency.review");
  return provisionAgency(tx, actor, app.applicant, { name: app.proposedAgencyName, logoKey: app.proposedLogoKey, description: app.description, contactEmail: app.applicantEmail, contactPhone: app.applicantPhone, country: app.country, city: app.city, website: app.website, source: "APPLICATION", applicationId: app.id, planKey: app.preferredPlanKey });
}

export const directAgencySchema = z.object({
  ownerEmail: z.string().trim().email("Enter the owner's account email."),
  name: z.string().trim().min(2).max(120),
  description: optionalText(4000),
  contactEmail: z.string().trim().email().optional().or(z.literal("")),
  contactPhone: optionalText(40),
  country: z.string().trim().min(2).max(80),
  city: optionalText(80),
  website: z.string().trim().url().optional().or(z.literal("")),
  reason: z.string().trim().min(3, "Say why this agency is created without an application.").max(1000),
  planKey: z.string().trim().max(40).optional().or(z.literal("")),
});

/** Super Admin only (agency.create_direct). The owner must already have an account that is not Hirewise staff. */
export async function createAgencyDirect(db: PrismaClient, actor: Actor, raw: z.input<typeof directAgencySchema>) {
  authorize(actor, "agency.create_direct");
  const input = directAgencySchema.parse(raw);
  const owner = await userRepository.findForAgency(db, { email: input.ownerEmail });
  if (!owner) throw Object.assign(new Error("No account with that email. The owner must register first."), { name: "UploadRejectedError", field: "ownerEmail" });
  if (["SUPER_ADMIN", "ADMIN", "SALES", "RECRUITER", "COACH", "OPERATIONS"].includes(owner.role.key)) throw new ForbiddenError("A Hirewise staff account cannot own an agency.");
  if (owner.agencyUsers.length) throw new Error("That account already belongs to an agency.");
  return db.$transaction(async (tx) => {
    const id = await provisionAgency(tx, actor, owner, { name: input.name, logoKey: null, description: input.description || null, contactEmail: input.contactEmail || owner.email, contactPhone: input.contactPhone || null, country: input.country, city: input.city || null, website: input.website || null, source: "DIRECT", planKey: input.planKey || null });
    await audit(tx, { actor, action: "AGENCY_UPDATED", entityType: "Agency", entityId: id, newValue: { op: "direct-create" }, reason: input.reason });
    return id;
  });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function listAgencies(db: PrismaClient, actor: Actor, f: { status?: AgencyStatus | ""; q?: string } = {}) {
  authorize(actor, "agency.read");
  return (await agencyRepository.listAgencies(db, { status: f.status || undefined, q: f.q || undefined })).map(toAgencyStaffView);
}

export async function getAgencyForStaff(db: PrismaClient, actor: Actor, agencyId: string) {
  authorize(actor, "agency.read");
  const a = await agencyRepository.findAgency(db, agencyId);
  if (!a) throw new NotFoundError();
  return toAgencyStaffView(a);
}

/** The agency portal's own view. NotFound for anyone without a seat. */
export async function myAgency(db: PrismaClient, actor: Actor) {
  if (!actor.agency) throw new NotFoundError();
  const a = await agencyRepository.findAgency(db, actor.agency.id);
  if (!a) throw new NotFoundError();
  assertAgencyScope(actor, a.id);
  return toAgencyOwnerView(a);
}

/** Agents whose primary agency is the actor's (or, for staff, the given agency). Tenant-scoped by construction. */
export async function agencyAgents(db: PrismaClient, actor: Actor, agencyId?: string) {
  const id = agencyId && actor.permissions.has("agency.read") ? agencyId : actor.agency?.id;
  if (!id) throw new NotFoundError();
  assertAgencyScope(actor, id, "agency.read");
  if (!actor.permissions.has("agency.read")) authorize(actor, "agency.team.read");
  return (await membershipRepository.membersOf(db, id)).map((m) => ({ id: m.agentProfileId, membershipId: m.id, displayName: m.agentProfile.displayName, primaryRole: m.agentProfile.primaryRole, status: m.agentProfile.status, availabilityStatus: m.agentProfile.availabilityStatus, verificationLevel: m.agentProfile.verificationLevel, profileCompletion: m.agentProfile.profileCompletion, membershipStatus: m.status, joinedAt: m.joinedAt, invitationSource: m.invitationSource }));
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export const agencyProfileSchema = z.object({
  name: z.string().trim().min(2, "Name your agency.").max(120),
  description: optionalText(4000),
  contactEmail: z.string().trim().email("Enter a contact email."),
  contactPhone: optionalText(40),
  country: z.string().trim().min(2).max(80),
  city: optionalText(80),
  website: z.string().trim().url("Enter a full URL, including https://").optional().or(z.literal("")),
});

/** Owners (and managers granted agency.profile.manage) edit their own agency; staff with agency.manage edit any. */
export async function updateAgencyProfile(db: PrismaClient, actor: Actor, agencyId: string, raw: z.input<typeof agencyProfileSchema>) {
  const input = agencyProfileSchema.parse(raw);
  if (!actor.permissions.has("agency.manage")) {
    authorize(actor, "agency.profile.manage");
    requireActiveAgency(actor);
  }
  assertAgencyScope(actor, agencyId);
  const a = await agencyRepository.findAgency(db, agencyId);
  if (!a) throw new NotFoundError();
  await db.$transaction(async (tx) => {
    await agencyRepository.updateAgency(tx, a.id, { name: input.name, description: input.description || null, contactEmail: input.contactEmail, contactPhone: input.contactPhone || null, country: input.country, city: input.city || null, website: input.website || null });
    await audit(tx, { actor, action: "AGENCY_UPDATED", entityType: "Agency", entityId: a.id, previousValue: { name: a.name }, newValue: { name: input.name } });
  });
}

/** Suspend, reactivate, or deactivate (agency.manage, reason required). Data is never deleted. */
export async function setAgencyStatus(db: PrismaClient, actor: Actor, agencyId: string, to: AgencyStatus, reason: string) {
  const a = await agencyRepository.findAgency(db, agencyId);
  if (!a) throw new NotFoundError();
  assertAgencyStatusTransition(actor, a.status, to, reason);
  const action = to === "SUSPENDED" ? "AGENCY_SUSPENDED" : to === "INACTIVE" ? "AGENCY_DEACTIVATED" : "AGENCY_REACTIVATED";
  await db.$transaction(async (tx) => {
    await agencyRepository.updateAgency(tx, a.id, { status: to, statusReason: reason.trim(), suspendedAt: to === "SUSPENDED" ? new Date() : a.suspendedAt, deactivatedAt: to === "INACTIVE" ? new Date() : to === "ACTIVE" ? null : a.deactivatedAt });
    await audit(tx, { actor, action, entityType: "Agency", entityId: a.id, previousValue: { status: a.status }, newValue: { status: to }, reason: reason.trim() });
    await publishEvent(tx, "AGENCY_STATUS_CHANGED", { agencyId: a.id, agencyName: a.name, status: to, reason: reason.trim(), ownerUserId: a.ownerUserId, ownerEmail: a.owner.email });
  });
}

/** Admin override of an agent's primary agency (agency.manage): null moves them to Hirewise Direct. */
export async function setAgentAgency(db: PrismaClient, actor: Actor, agentProfileId: string, agencyId: string | null, reason: string) {
  authorize(actor, "agency.manage");
  if (!reason.trim()) throw new ForbiddenError("A reason is required to change an agent's agency.");
  if (agencyId) {
    const a = await agencyRepository.findAgency(db, agencyId);
    if (!a) throw new NotFoundError();
  }
  const profile = await membershipRepository.profileIdentity(db, agentProfileId);
  if (!profile) throw new NotFoundError();
  const current = await membershipRepository.openForProfile(db, agentProfileId);
  // v2 phase 2: ending releases the seat; joining takes one (Hirewise adds seats first if the agency is full).
  await db.$transaction(async (tx) => {
    if (current) await endMembershipTx(tx, actor, current, { reason: reason.trim(), endedById: actor.userId });
    if (agencyId) await joinAgencyTx(tx, actor, { agencyId, agentProfileId, platformIdentityId: profile.platformIdentityId, status: profile.user.emailVerifiedAt ? "ACTIVE" : "PENDING_VERIFICATION", source: "ADMIN", approvedById: actor.userId, allowOverCapacity: true, reason: `Admin override: ${reason.trim()}` });
  });
}

export function membershipHistory(db: PrismaClient, actor: Actor, agentProfileId: string) {
  authorize(actor, "agency.read");
  return agencyRepository.membershipHistory(db, agentProfileId);
}
