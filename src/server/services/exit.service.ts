import { z } from "zod";
import type { PrismaClient, Db } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { systemActor } from "@/server/auth/actor";
import type { RequestMeta } from "@/server/auth/session";
import { authorize, ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { scopedAgencyId, requireActiveAgency } from "@/server/policies/ownership";
import { exitRepository, type ExitRequestRecord } from "@/server/repositories/exit.repository";
import { membershipRepository, type MemberRecord } from "@/server/repositories/membership.repository";
import { seatRepository } from "@/server/repositories/seat.repository";
import { audit } from "@/server/audit/audit";
import { publishEvent } from "@/server/events/outbox";
import { getSetting } from "@/server/services/setting.service";
import { assertExitTransition, type ExitStatus } from "@/server/state/exit-request";
import { assertMembershipTransition, type MembershipStatus } from "@/server/state/agency-membership";
import { toExitRequestView } from "@/server/views/exit.views";

/**
 * Exit flows (v2 phase 3): Request to Leave (agent), Remove Agent (agency), owner and Hirewise review, effective
 * options, and the exit actions. No membership ends unilaterally; every end runs through completeExitTx or the
 * Admin override, both of which release the seat per the configured rule and mark the profile as a former agent.
 */

export type EffectiveOption = "IMMEDIATE" | "END_OF_ASSIGNMENT" | "END_OF_BILLING_PERIOD";

const EFFECTIVE_OPTIONS = ["IMMEDIATE", "END_OF_ASSIGNMENT", "END_OF_BILLING_PERIOD"] as const;

export const leaveRequestSchema = z.object({
  reason: z.string().trim().min(10, "Tell your agency and Hirewise why you want to leave, in at least 10 characters.").max(2000),
  effectiveOption: z.enum(EFFECTIVE_OPTIONS).default("IMMEDIATE"),
  requestedEffectiveDate: z.string().trim().optional().or(z.literal("")),
});

export const removalRequestSchema = z.object({
  membershipId: z.string().min(1),
  reason: z.string().trim().min(10, "Give the agent and Hirewise a reason, in at least 10 characters.").max(2000),
  effectiveOption: z.enum(EFFECTIVE_OPTIONS).default("IMMEDIATE"),
  requestedEffectiveDate: z.string().trim().optional().or(z.literal("")),
});

export const exitDecisionSchema = z.object({
  decision: z.enum(["APPROVE", "DECLINE"]),
  effectiveOption: z.enum(EFFECTIVE_OPTIONS).optional(),
  note: z.string().trim().max(1000).optional().or(z.literal("")),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseDate(v: string | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The next period boundary after `now`, counting whole periods from the plan start. */
export function nextBillingBoundary(planStartedAt: Date | null, period: "MONTHLY" | "ANNUAL" | null, now = new Date()): Date {
  const start = planStartedAt ?? now;
  const d = new Date(start);
  const step = () => (period === "ANNUAL" ? d.setUTCFullYear(d.getUTCFullYear() + 1) : d.setUTCMonth(d.getUTCMonth() + 1));
  while (d.getTime() <= now.getTime()) step();
  return d;
}

/** When a membership should end for an option; null means "when the agent's last open placement closes". */
async function effectiveDateFor(db: Db, r: { effectiveOption: EffectiveOption; requestedEffectiveDate: Date | null; membership: { agency: { planStartedAt: Date | null; plan: { billingPeriod: "MONTHLY" | "ANNUAL" } | null } | null } }, now = new Date()): Promise<Date | null> {
  void db;
  if (r.effectiveOption === "IMMEDIATE") return now;
  if (r.effectiveOption === "END_OF_BILLING_PERIOD") return nextBillingBoundary(r.membership.agency?.planStartedAt ?? null, r.membership.agency?.plan?.billingPeriod ?? null, now);
  return null;
}

async function hirewiseReviewRequired(db: Db, agentProfileId: string): Promise<string | null> {
  const settings = await getSetting(db, "agencyExit");
  if (settings.adminReviewAlways) return "Hirewise reviews every exit (setting)";
  const open = await exitRepository.openPlacementCount(db, agentProfileId);
  return open > 0 ? `The agent has ${open} open client assignment(s)` : null;
}

function releaseRuleFor(option: EffectiveOption, configured: "IMMEDIATE" | "AFTER_BILLING_PERIOD" | "AFTER_ASSIGNMENT_ENDS"): "IMMEDIATE" | "AFTER_BILLING_PERIOD" | "AFTER_ASSIGNMENT_ENDS" {
  // The membership already waits for the option; the seat follows the configured rule on top of that.
  if (option === "END_OF_ASSIGNMENT" && configured === "AFTER_ASSIGNMENT_ENDS") return "IMMEDIATE";
  if (option === "END_OF_BILLING_PERIOD" && configured === "AFTER_BILLING_PERIOD") return "IMMEDIATE";
  return configured;
}

// ---------------------------------------------------------------------------
// Exit actions
// ---------------------------------------------------------------------------

/**
 * Ends a membership: seat released now or marked pending per the rule, profile marked FORMER_AGENCY_AGENT and hidden,
 * event for the credential (phase 4) and submission (phase 5) handlers. Nothing is deleted.
 */
export async function completeExitTx(tx: Db, actor: Actor, m: MemberRecord, p: { reason: string; endedById: string | null; exitRequestId: string | null; releaseRule: "IMMEDIATE" | "AFTER_BILLING_PERIOD" | "AFTER_ASSIGNMENT_ENDS" }): Promise<void> {
  assertMembershipTransition(m.status as MembershipStatus, "ENDED");
  const now = new Date();
  await membershipRepository.update(tx, m.id, { status: "ENDED", leftAt: now, endReason: p.reason, endedById: p.endedById });
  await exitRepository.setMembershipExit(tx, m.id, { exitRequestId: p.exitRequestId, seatReleaseRule: p.releaseRule, effectiveEndAt: now });
  if (m.seatLedgerEntryId && m.agencyId) {
    if (p.releaseRule === "IMMEDIATE") {
      const entry = await seatRepository.addLedger(tx, { agencyId: m.agencyId, changeType: "RELEASED", quantity: 1, reason: p.reason, relatedAgentProfileId: m.agentProfileId, relatedMembershipId: m.id, createdById: actor.userId === "system" ? null : actor.userId });
      await exitRepository.setMembershipExit(tx, m.id, { seatReleasedAt: now });
      await audit(tx, { actor, action: "AGENCY_SEATS_CHANGED", entityType: "AgencySeatLedger", entityId: entry.id, newValue: { agencyId: m.agencyId, changeType: "RELEASED", quantity: 1, membershipId: m.id } });
    } else {
      const entry = await seatRepository.addLedger(tx, { agencyId: m.agencyId, changeType: "PENDING_RELEASE", quantity: 1, reason: `${p.reason} (seat released ${p.releaseRule === "AFTER_BILLING_PERIOD" ? "at the end of the billing period" : "when the agent's assignments end"})`, relatedAgentProfileId: m.agentProfileId, relatedMembershipId: m.id, createdById: actor.userId === "system" ? null : actor.userId });
      await audit(tx, { actor, action: "AGENCY_SEATS_CHANGED", entityType: "AgencySeatLedger", entityId: entry.id, newValue: { agencyId: m.agencyId, changeType: "PENDING_RELEASE", quantity: 1, membershipId: m.id, rule: p.releaseRule } });
    }
  }
  await exitRepository.markFormer(tx, m.agentProfileId, m.agencyId!);
  await audit(tx, { actor, action: "AGENCY_MEMBERSHIP_ENDED", entityType: "AgencyMembership", entityId: m.id, previousValue: { status: m.status, agencyId: m.agencyId }, newValue: { status: "ENDED", profileStatus: "FORMER_AGENCY_AGENT", releaseRule: p.releaseRule }, reason: p.reason });
  await publishEvent(tx, "AGENCY_EXIT_COMPLETED", { membershipId: m.id, exitRequestId: p.exitRequestId, agencyId: m.agencyId!, agencyName: m.agency?.name ?? "", ownerUserId: m.agency?.ownerUserId ?? "", agentProfileId: m.agentProfileId, agentUserId: m.agentProfile.user ? (await membershipRepository.profileIdentity(tx, m.agentProfileId))?.userId ?? "" : "", displayName: m.agentProfile.displayName, reason: p.reason });
}

/** Releases a seat that was left pending (worker, when the rule's condition is met). */
export async function releaseHeldSeatTx(tx: Db, actor: Actor, m: { id: string; agencyId: string | null; agentProfileId: string }, reason: string): Promise<void> {
  if (!m.agencyId) return;
  const entry = await seatRepository.addLedger(tx, { agencyId: m.agencyId, changeType: "RELEASED", quantity: 1, reason, relatedAgentProfileId: m.agentProfileId, relatedMembershipId: m.id, createdById: null });
  await exitRepository.setMembershipExit(tx, m.id, { seatReleasedAt: new Date() });
  await audit(tx, { actor, action: "AGENCY_SEATS_CHANGED", entityType: "AgencySeatLedger", entityId: entry.id, newValue: { agencyId: m.agencyId, changeType: "RELEASED", quantity: 1, membershipId: m.id } });
}

// ---------------------------------------------------------------------------
// Agent: Request to Leave
// ---------------------------------------------------------------------------

async function ownMembership(db: Db, actor: Actor): Promise<MemberRecord> {
  if (actor.role !== "AGENT" || !actor.agentProfileId) throw new ForbiddenError("Only talent accounts belong to an agency");
  const m = await membershipRepository.openForProfile(db, actor.agentProfileId);
  if (!m) throw new NotFoundError("You are not a member of an agency");
  return m;
}

/** The agent's own agency membership and any open exit request (dashboard card). */
export async function myMembership(db: PrismaClient, actor: Actor) {
  if (actor.role !== "AGENT" || !actor.agentProfileId) return null;
  const m = await membershipRepository.openForProfile(db, actor.agentProfileId);
  if (!m) {
    const profile = await exitRepository.profileBasics(db, actor.agentProfileId);
    if (profile?.status === "FORMER_AGENCY_AGENT" && profile.formerAgencyId) {
      const former = await db.agency.findUnique({ where: { id: profile.formerAgencyId }, select: { name: true } });
      return { kind: "FORMER" as const, agencyName: former?.name ?? "your agency", formerAt: profile.formerAt };
    }
    return null;
  }
  const open = await exitRepository.openForMembership(db, m.id);
  return { kind: "MEMBER" as const, membershipId: m.id, agencyName: m.agency?.name ?? "", status: m.status, joinedAt: m.joinedAt, effectiveEndAt: m.effectiveEndAt, exit: open ? toExitRequestView(open, "AGENT") : null };
}

export async function requestLeave(db: PrismaClient, actor: Actor, raw: z.input<typeof leaveRequestSchema>, meta: RequestMeta) {
  const input = leaveRequestSchema.parse(raw);
  const m = await ownMembership(db, actor);
  if (m.status !== "ACTIVE") throw new ForbiddenError(`Your membership is ${m.status.toLowerCase().replace(/_/g, " ")}; no new request can be made.`);
  if (await exitRepository.openForMembership(db, m.id)) throw new ForbiddenError("A request is already open for your membership.");
  const adminReason = await hirewiseReviewRequired(db, m.agentProfileId);
  return db.$transaction(async (tx) => {
    const r = await exitRepository.create(tx, { membershipId: m.id, agencyId: m.agencyId!, agentProfileId: m.agentProfileId, platformIdentityId: m.platformIdentityId, type: "AGENT_REQUESTED_LEAVE", reason: input.reason, effectiveOption: input.effectiveOption, requestedEffectiveDate: parseDate(input.requestedEffectiveDate), status: "PENDING_AGENCY", requestedById: actor.userId, adminRequired: !!adminReason, adminRequiredReason: adminReason });
    assertMembershipTransition("ACTIVE", "EXIT_REQUESTED");
    await membershipRepository.update(tx, m.id, { status: "EXIT_REQUESTED" });
    await exitRepository.setMembershipExit(tx, m.id, { exitRequestId: r.id });
    await audit(tx, { actor, action: "EXIT_REQUESTED", entityType: "ExitRequest", entityId: r.id, newValue: { type: r.type, membershipId: m.id, agencyId: m.agencyId, effectiveOption: input.effectiveOption, adminRequired: !!adminReason }, reason: input.reason, ipAddress: meta.ipAddress ?? undefined });
    await publishEvent(tx, "EXIT_REQUESTED", { exitRequestId: r.id, type: r.type, agencyId: m.agencyId!, agencyName: m.agency?.name ?? "", ownerUserId: m.agency?.ownerUserId ?? "", agentUserId: (await membershipRepository.profileIdentity(tx, m.agentProfileId))?.userId ?? "", agentEmail: m.agentProfile.user.email, displayName: m.agentProfile.displayName, reason: input.reason, effectiveOption: input.effectiveOption });
    return toExitRequestView(r, "AGENT");
  });
}

export async function cancelLeave(db: PrismaClient, actor: Actor, meta: RequestMeta) {
  const m = await ownMembership(db, actor);
  const r = await exitRepository.openForMembership(db, m.id);
  if (!r || r.type !== "AGENT_REQUESTED_LEAVE") throw new NotFoundError("No open request to cancel");
  if (r.status === "APPROVED") throw new ForbiddenError("The request was already approved; contact your agency or Hirewise.");
  assertExitTransition(r.status as ExitStatus, "CANCELLED");
  await db.$transaction(async (tx) => {
    await exitRepository.update(tx, r.id, { status: "CANCELLED" });
    await membershipRepository.update(tx, m.id, { status: "ACTIVE" });
    await exitRepository.setMembershipExit(tx, m.id, { exitRequestId: null });
    await audit(tx, { actor, action: "EXIT_CANCELLED", entityType: "ExitRequest", entityId: r.id, previousValue: { status: r.status }, newValue: { status: "CANCELLED" }, ipAddress: meta.ipAddress ?? undefined });
    await publishEvent(tx, "EXIT_DECIDED", { exitRequestId: r.id, type: r.type, decision: "CANCELLED", by: "AGENT", agencyId: m.agencyId!, agencyName: m.agency?.name ?? "", ownerUserId: m.agency?.ownerUserId ?? "", agentUserId: (await membershipRepository.profileIdentity(tx, m.agentProfileId))?.userId ?? "", agentEmail: m.agentProfile.user.email, displayName: m.agentProfile.displayName, note: null, effectiveAt: null });
  });
}

// ---------------------------------------------------------------------------
// Agency: Remove Agent and review of leave requests
// ---------------------------------------------------------------------------

export async function requestRemoval(db: PrismaClient, actor: Actor, raw: z.input<typeof removalRequestSchema>, meta: RequestMeta) {
  authorize(actor, "agency.team.remove");
  const agencyId = requireActiveAgency(actor);
  const input = removalRequestSchema.parse(raw);
  const m = await membershipRepository.find(db, input.membershipId);
  if (!m || m.agencyId !== agencyId) throw new NotFoundError();
  if (m.status !== "ACTIVE") throw new ForbiddenError(`This membership is ${m.status.toLowerCase().replace(/_/g, " ")}.`);
  if (await exitRepository.openForMembership(db, m.id)) throw new ForbiddenError("A request is already open for this member.");
  const adminReason = await hirewiseReviewRequired(db, m.agentProfileId);
  const settings = await getSetting(db, "agencySeats");
  return db.$transaction(async (tx) => {
    const r = await exitRepository.create(tx, { membershipId: m.id, agencyId, agentProfileId: m.agentProfileId, platformIdentityId: m.platformIdentityId, type: "AGENCY_REQUESTED_REMOVAL", reason: input.reason, effectiveOption: input.effectiveOption, requestedEffectiveDate: parseDate(input.requestedEffectiveDate), status: adminReason ? "PENDING_ADMIN" : "PENDING_AGENCY", requestedById: actor.userId, adminRequired: !!adminReason, adminRequiredReason: adminReason });
    assertMembershipTransition("ACTIVE", "REMOVAL_REQUESTED");
    await membershipRepository.update(tx, m.id, { status: "REMOVAL_REQUESTED" });
    await exitRepository.setMembershipExit(tx, m.id, { exitRequestId: r.id });
    await audit(tx, { actor, action: "EXIT_REQUESTED", entityType: "ExitRequest", entityId: r.id, newValue: { type: r.type, membershipId: m.id, agencyId, effectiveOption: input.effectiveOption, adminRequired: !!adminReason }, reason: input.reason, ipAddress: meta.ipAddress ?? undefined });
    const agentUserId = (await membershipRepository.profileIdentity(tx, m.agentProfileId))?.userId ?? "";
    await publishEvent(tx, "EXIT_REQUESTED", { exitRequestId: r.id, type: r.type, agencyId, agencyName: m.agency?.name ?? "", ownerUserId: m.agency?.ownerUserId ?? "", agentUserId, agentEmail: m.agentProfile.user.email, displayName: m.agentProfile.displayName, reason: input.reason, effectiveOption: input.effectiveOption });
    if (!adminReason) {
      // The agency's own removal needs no owner review: it is approved on creation and completes per the option.
      const approved = await approveTx(tx, actor, r, { by: "AGENCY", note: null, effectiveOption: input.effectiveOption, releaseRule: settings.seatReleaseRule });
      return toExitRequestView(approved, "OWNER");
    }
    return toExitRequestView(r, "OWNER");
  });
}

/** Shared approval: sets the effective date, moves the membership to ENDING (or completes it when immediate). */
async function approveTx(tx: Db, actor: Actor, r: ExitRequestRecord, p: { by: "AGENCY" | "ADMIN"; note: string | null; effectiveOption: EffectiveOption; releaseRule: "IMMEDIATE" | "AFTER_BILLING_PERIOD" | "AFTER_ASSIGNMENT_ENDS" }): Promise<ExitRequestRecord> {
  assertExitTransition(r.status as ExitStatus, "APPROVED");
  const effectiveAt = await effectiveDateFor(tx, { effectiveOption: p.effectiveOption, requestedEffectiveDate: r.requestedEffectiveDate, membership: r.membership });
  const decision = p.by === "AGENCY" ? { agencyDecision: "APPROVED" as const, agencyDecidedById: actor.userId, agencyDecisionNote: p.note, agencyDecidedAt: new Date() } : { adminDecision: "APPROVED" as const, adminDecidedById: actor.userId, adminDecisionNote: p.note, adminDecidedAt: new Date() };
  let updated = await exitRepository.update(tx, r.id, { status: "APPROVED", effectiveOption: p.effectiveOption, effectiveAt, ...decision });
  const m = await membershipRepository.find(tx, r.membershipId);
  if (!m) throw new NotFoundError();
  await audit(tx, { actor, action: p.by === "AGENCY" ? "EXIT_AGENCY_DECIDED" : "EXIT_ADMIN_DECIDED", entityType: "ExitRequest", entityId: r.id, previousValue: { status: r.status }, newValue: { status: "APPROVED", effectiveOption: p.effectiveOption, effectiveAt }, reason: p.note ?? undefined });
  if (p.effectiveOption === "IMMEDIATE") {
    await completeExitTx(tx, actor, m, { reason: `${r.type === "AGENT_REQUESTED_LEAVE" ? "Left at own request" : "Removed by the agency"}: ${r.reason}`, endedById: actor.userId, exitRequestId: r.id, releaseRule: releaseRuleFor(p.effectiveOption, p.releaseRule) });
    updated = await exitRepository.update(tx, r.id, { status: "COMPLETED", completedAt: new Date() });
    await audit(tx, { actor, action: "EXIT_COMPLETED", entityType: "ExitRequest", entityId: r.id, newValue: { membershipId: m.id } });
  } else {
    assertMembershipTransition(m.status as MembershipStatus, "ENDING");
    await membershipRepository.update(tx, m.id, { status: "ENDING" });
    await exitRepository.setMembershipExit(tx, m.id, { effectiveEndAt: effectiveAt });
  }
  const agentUserId = (await membershipRepository.profileIdentity(tx, m.agentProfileId))?.userId ?? "";
  await publishEvent(tx, "EXIT_DECIDED", { exitRequestId: r.id, type: r.type, decision: "APPROVED", by: p.by, agencyId: m.agencyId!, agencyName: m.agency?.name ?? "", ownerUserId: m.agency?.ownerUserId ?? "", agentUserId, agentEmail: m.agentProfile.user.email, displayName: m.agentProfile.displayName, note: p.note, effectiveAt: effectiveAt ? effectiveAt.toISOString() : null });
  return updated;
}

async function declineTx(tx: Db, actor: Actor, r: ExitRequestRecord, p: { by: "AGENCY" | "ADMIN"; note: string | null }): Promise<ExitRequestRecord> {
  assertExitTransition(r.status as ExitStatus, "DECLINED");
  const decision = p.by === "AGENCY" ? { agencyDecision: "DECLINED" as const, agencyDecidedById: actor.userId, agencyDecisionNote: p.note, agencyDecidedAt: new Date() } : { adminDecision: "DECLINED" as const, adminDecidedById: actor.userId, adminDecisionNote: p.note, adminDecidedAt: new Date() };
  const updated = await exitRepository.update(tx, r.id, { status: "DECLINED", ...decision });
  await membershipRepository.update(tx, r.membershipId, { status: "ACTIVE" });
  await exitRepository.setMembershipExit(tx, r.membershipId, { exitRequestId: null });
  await audit(tx, { actor, action: p.by === "AGENCY" ? "EXIT_AGENCY_DECIDED" : "EXIT_ADMIN_DECIDED", entityType: "ExitRequest", entityId: r.id, previousValue: { status: r.status }, newValue: { status: "DECLINED" }, reason: p.note ?? undefined });
  const m = r.membership;
  const agentUserId = (await membershipRepository.profileIdentity(tx, m.agentProfileId))?.userId ?? "";
  await publishEvent(tx, "EXIT_DECIDED", { exitRequestId: r.id, type: r.type, decision: "DECLINED", by: p.by, agencyId: m.agencyId!, agencyName: m.agency?.name ?? "", ownerUserId: m.agency?.ownerUserId ?? "", agentUserId, agentEmail: m.agentProfile.user.email, displayName: m.agentProfile.displayName, note: p.note, effectiveAt: null });
  return updated;
}

/** The owner (or a manager with agency.team.remove) decides a leave request. Approval may hand over to Hirewise. */
export async function agencyDecide(db: PrismaClient, actor: Actor, id: string, raw: z.input<typeof exitDecisionSchema>) {
  authorize(actor, "agency.team.remove");
  const agencyId = requireActiveAgency(actor);
  const input = exitDecisionSchema.parse(raw);
  const r = await exitRepository.find(db, id);
  if (!r || r.agencyId !== agencyId) throw new NotFoundError();
  if (r.status !== "PENDING_AGENCY") throw new ForbiddenError("This request is not waiting for the agency.");
  const settings = await getSetting(db, "agencySeats");
  return db.$transaction(async (tx) => {
    if (input.decision === "DECLINE") return toExitRequestView(await declineTx(tx, actor, r, { by: "AGENCY", note: input.note || null }), "OWNER");
    const option = input.effectiveOption ?? (r.effectiveOption as EffectiveOption);
    if (r.adminRequired) {
      assertExitTransition(r.status as ExitStatus, "PENDING_ADMIN");
      const updated = await exitRepository.update(tx, r.id, { status: "PENDING_ADMIN", effectiveOption: option, agencyDecision: "APPROVED", agencyDecidedById: actor.userId, agencyDecisionNote: input.note || null, agencyDecidedAt: new Date() });
      await audit(tx, { actor, action: "EXIT_AGENCY_DECIDED", entityType: "ExitRequest", entityId: r.id, previousValue: { status: r.status }, newValue: { status: "PENDING_ADMIN", effectiveOption: option }, reason: input.note || undefined });
      await publishEvent(tx, "EXIT_ESCALATED", { exitRequestId: r.id, type: r.type, agencyId: r.agencyId, agencyName: r.membership.agency?.name ?? "", displayName: r.membership.agentProfile.displayName, why: r.adminRequiredReason ?? "Hirewise review required" });
      return toExitRequestView(updated, "OWNER");
    }
    return toExitRequestView(await approveTx(tx, actor, r, { by: "AGENCY", note: input.note || null, effectiveOption: option, releaseRule: settings.seatReleaseRule }), "OWNER");
  });
}

/** Hirewise decides a request that needs its review or was escalated. */
export async function adminDecide(db: PrismaClient, actor: Actor, id: string, raw: z.input<typeof exitDecisionSchema>) {
  authorize(actor, "agency.manage");
  const input = exitDecisionSchema.parse(raw);
  const r = await exitRepository.find(db, id);
  if (!r) throw new NotFoundError();
  if (r.status !== "PENDING_ADMIN") throw new ForbiddenError("This request is not waiting for Hirewise.");
  const settings = await getSetting(db, "agencySeats");
  return db.$transaction(async (tx) => {
    if (input.decision === "DECLINE") return toExitRequestView(await declineTx(tx, actor, r, { by: "ADMIN", note: input.note || null }), "STAFF");
    return toExitRequestView(await approveTx(tx, actor, r, { by: "ADMIN", note: input.note || null, effectiveOption: input.effectiveOption ?? (r.effectiveOption as EffectiveOption), releaseRule: settings.seatReleaseRule }), "STAFF");
  });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function exitRequestsForAgency(db: PrismaClient, actor: Actor, requestedAgencyId?: string) {
  const agencyId = scopedAgencyId(actor, requestedAgencyId, "agency.read");
  if (!actor.permissions.has("agency.read")) authorize(actor, "agency.team.read");
  return (await exitRepository.listForAgency(db, agencyId)).map((r) => toExitRequestView(r, actor.permissions.has("agency.read") ? "STAFF" : "OWNER"));
}

export async function exitRequestsForStaff(db: PrismaClient, actor: Actor, status?: ExitStatus) {
  authorize(actor, "agency.read");
  const [rows, counts] = await Promise.all([exitRepository.listForStaff(db, status), exitRepository.counts(db)]);
  return { rows: rows.map((r) => toExitRequestView(r, "STAFF")), counts };
}

// ---------------------------------------------------------------------------
// Worker housekeeping
// ---------------------------------------------------------------------------

/** Owner silence: agency-pending requests older than the window go to Hirewise. */
export async function escalateStaleExitRequests(db: PrismaClient, now = new Date()): Promise<number> {
  const settings = await getSetting(db, "agencyExit");
  const stale = await exitRepository.staleForAgency(db, new Date(now.getTime() - settings.ownerResponseDays * 24 * 60 * 60_000));
  const actor = systemActor();
  for (const r of stale) {
    await db.$transaction(async (tx) => {
      assertExitTransition("PENDING_AGENCY", "PENDING_ADMIN");
      await exitRepository.update(tx, r.id, { status: "PENDING_ADMIN", escalatedAt: now, adminRequired: true, adminRequiredReason: `The agency did not respond within ${settings.ownerResponseDays} days` });
      await audit(tx, { actor, action: "EXIT_ESCALATED", entityType: "ExitRequest", entityId: r.id, newValue: { after: settings.ownerResponseDays } });
      await publishEvent(tx, "EXIT_ESCALATED", { exitRequestId: r.id, type: r.type, agencyId: r.agencyId, agencyName: r.membership.agency?.name ?? "", displayName: r.membership.agentProfile.displayName, why: `No response from the agency within ${settings.ownerResponseDays} days` });
    });
  }
  return stale.length;
}

/** Approved requests whose date has come (or whose agent has no open placement left) complete now. */
export async function completeDueExits(db: PrismaClient, now = new Date()): Promise<number> {
  const due = await exitRepository.approvedDue(db, now);
  const settings = await getSetting(db, "agencySeats");
  const actor = systemActor();
  let n = 0;
  for (const r of due) {
    if (r.effectiveOption === "END_OF_ASSIGNMENT" && !r.effectiveAt && (await exitRepository.openPlacementCount(db, r.agentProfileId)) > 0) continue;
    const m = await membershipRepository.find(db, r.membershipId);
    if (!m || m.status === "ENDED") continue;
    await db.$transaction(async (tx) => {
      await completeExitTx(tx, actor, m, { reason: `${r.type === "AGENT_REQUESTED_LEAVE" ? "Left at own request" : "Removed by the agency"}: ${r.reason}`, endedById: null, exitRequestId: r.id, releaseRule: releaseRuleFor(r.effectiveOption as EffectiveOption, settings.seatReleaseRule) });
      await exitRepository.update(tx, r.id, { status: "COMPLETED", completedAt: now, effectiveAt: r.effectiveAt ?? now });
      await audit(tx, { actor, action: "EXIT_COMPLETED", entityType: "ExitRequest", entityId: r.id, newValue: { membershipId: m.id } });
    });
    n += 1;
  }
  return n;
}

/** Seats held after an exit are released when the billing period ends or the agent's last assignment closes. */
export async function releaseDueSeats(db: PrismaClient, now = new Date()): Promise<number> {
  const held = await exitRepository.endedWithSeatHeld(db);
  const actor = systemActor();
  let n = 0;
  for (const m of held) {
    let due = false;
    if (m.seatReleaseRule === "AFTER_BILLING_PERIOD") due = nextBillingBoundary(m.agency?.planStartedAt ?? null, m.agency?.plan?.billingPeriod ?? null, m.leftAt ?? now).getTime() <= now.getTime();
    else if (m.seatReleaseRule === "AFTER_ASSIGNMENT_ENDS") due = (await exitRepository.openPlacementCount(db, m.agentProfileId)) === 0;
    else due = true;
    if (!due) continue;
    await db.$transaction((tx) => releaseHeldSeatTx(tx, actor, m, m.seatReleaseRule === "AFTER_BILLING_PERIOD" ? "Billing period ended after exit" : "Assignments ended after exit"));
    n += 1;
  }
  return n;
}

/** Former agents are archived after the configured window; history stays on the identity. */
export async function archiveFormerProfiles(db: PrismaClient, now = new Date()): Promise<number> {
  const settings = await getSetting(db, "agencyExit");
  const due = await exitRepository.formerDue(db, new Date(now.getTime() - settings.archiveAfterDays * 24 * 60 * 60_000));
  const actor = systemActor();
  for (const p of due) {
    await db.$transaction(async (tx) => {
      await exitRepository.archive(tx, p.id);
      await audit(tx, { actor, action: "PROFILE_ARCHIVED", entityType: "AgentProfile", entityId: p.id, newValue: { userId: p.userId, after: settings.archiveAfterDays } });
    });
  }
  return due.length;
}
