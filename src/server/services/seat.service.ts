import { z } from "zod";
import { exitRepository } from "@/server/repositories/exit.repository";
import type { PrismaClient, Db } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { systemActor } from "@/server/auth/actor";
import { authorize, ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { scopedAgencyId, requireActiveAgency } from "@/server/policies/ownership";
import { seatRepository } from "@/server/repositories/seat.repository";
import { membershipRepository, type MemberRecord } from "@/server/repositories/membership.repository";
import { agencyRepository } from "@/server/repositories/agency.repository";
import { audit } from "@/server/audit/audit";
import { publishEvent } from "@/server/events/outbox";
import { getSetting } from "@/server/services/setting.service";
import { assertMembershipTransition, type MembershipStatus } from "@/server/state/agency-membership";
import { toPlanView, toPackageView, toLedgerEntryView, toSeatRequestView, toSeatPurchaseView, type SeatTotals } from "@/server/views/seat.views";
import { toMemberView } from "@/server/views/invite.views";

/**
 * Agent Seats (v2 phase 2): membership capacity per agency, kept as an append-only ledger whose totals are always
 * computed. Course Seats (training) are a different thing and live with the Academy.
 */

export type LedgerType = "PLAN_BASE" | "PURCHASE" | "PROMO_GRANT" | "ADMIN_ADD" | "ADMIN_REMOVE" | "OVERRIDE" | "CONSUMED" | "RELEASED" | "PENDING_RELEASE";

export class SeatCapacityError extends Error {
  readonly name = "SeatCapacityError";
  readonly status = 409;
  constructor(message = "No Available Agent Seats. Add more seats before inviting or joining.") {
    super(message);
  }
}

/**
 * `planReversed` is the sum of ADMIN_REMOVE entries that carry a planId: the base of a previous plan, taken back at a
 * plan change. It is subtracted from base rather than from adjustments so "base" always means the current plan.
 */
export function computeTotals(sums: Partial<Record<LedgerType, number>>, pendingRelease = 0, planReversed = 0): SeatTotals {
  const g = (k: LedgerType) => sums[k] ?? 0;
  const base = g("PLAN_BASE") - planReversed;
  const additional = g("PURCHASE");
  const promo = g("PROMO_GRANT");
  const adjustments = g("ADMIN_ADD") + g("OVERRIDE") - (g("ADMIN_REMOVE") - planReversed);
  const total = base + additional + promo + adjustments;
  const used = g("CONSUMED") - g("RELEASED");
  return { base, additional, promo, adjustments, total, used, pendingRelease, available: Math.max(0, total - used) };
}

export async function seatTotals(db: Db, agencyId: string): Promise<SeatTotals> {
  const [ledger, pending] = await Promise.all([seatRepository.ledgerSums(db, agencyId), exitRepository.pendingReleaseCount(db, agencyId)]);
  return computeTotals(ledger.sums as Partial<Record<LedgerType, number>>, pending, ledger.planReversed);
}

export async function assertCapacity(db: Db, agencyId: string, needed = 1): Promise<SeatTotals> {
  const totals = await seatTotals(db, agencyId);
  if (totals.available < needed) throw new SeatCapacityError();
  return totals;
}

// ---------------------------------------------------------------------------
// Membership + seat, inside the caller's transaction
// ---------------------------------------------------------------------------

export type JoinInput = {
  agencyId: string;
  agentProfileId: string;
  platformIdentityId: string | null;
  status: "PENDING_VERIFICATION" | "ACTIVE";
  source: "UNIQUE_LINK" | "EMAIL_INVITE" | "ADMIN" | "OWNER";
  invitedEmail?: string | null;
  approvedById?: string | null;
  /** The owner's own membership at approval is recorded even when no plan is assigned yet (decision 4). */
  allowOverCapacity?: boolean;
  reason?: string;
  emailInviteId?: string | null;
  linkId?: string | null;
};

/** Creates the membership, consumes exactly one seat, and points the profile at the agency. */
export async function joinAgencyTx(tx: Db, actor: Actor, p: JoinInput): Promise<MemberRecord> {
  const agency = await agencyRepository.findAgency(tx, p.agencyId);
  if (!agency) throw new NotFoundError();
  if (p.platformIdentityId) {
    const open = await membershipRepository.openForIdentity(tx, p.platformIdentityId);
    if (open) throw new ForbiddenError(open.agencyId === p.agencyId ? "This person is already a member of this agency." : "This person already belongs to another agency. Leaving an agency goes through Hirewise.");
  } else {
    const open = await membershipRepository.openForProfile(tx, p.agentProfileId);
    if (open) throw new ForbiddenError("This person already belongs to an agency.");
  }
  if (!p.allowOverCapacity) await assertCapacity(tx, p.agencyId);
  // v2 phase 3: a former or archived profile rejoins with a fresh profile (setting) or is reactivated.
  let agentProfileId = p.agentProfileId;
  let platformIdentityId = p.platformIdentityId;
  const basics = await exitRepository.profileBasics(tx, p.agentProfileId);
  if (basics && (basics.status === "FORMER_AGENCY_AGENT" || basics.status === "ARCHIVED")) {
    platformIdentityId = platformIdentityId ?? basics.platformIdentityId;
    const identitySettings = await getSetting(tx, "identity");
    if (identitySettings.rejoinCreatesFreshProfile) {
      if (!basics.archivedAt) {
        await exitRepository.archive(tx, basics.id);
        await audit(tx, { actor, action: "PROFILE_ARCHIVED", entityType: "AgentProfile", entityId: basics.id, newValue: { reason: "Rejoined an agency; a fresh profile starts" } });
      }
      const fresh = await exitRepository.createFreshProfile(tx, basics.id, platformIdentityId, basics.userId);
      agentProfileId = fresh.id;
      await audit(tx, { actor, action: "PROFILE_FRESH_CREATED", entityType: "AgentProfile", entityId: fresh.id, newValue: { fromProfileId: basics.id, agencyId: p.agencyId } });
    } else {
      await exitRepository.reactivateFormer(tx, basics.id);
    }
  }
  const m = await membershipRepository.create(tx, { agentProfileId, agencyId: p.agencyId, platformIdentityId, status: p.status, invitationSource: p.source, approvedById: p.approvedById ?? null, invitedEmail: p.invitedEmail ?? null });
  const entry = await seatRepository.addLedger(tx, { agencyId: p.agencyId, changeType: "CONSUMED", quantity: 1, reason: p.reason ?? `Member joined (${p.source.toLowerCase().replace(/_/g, " ")})`, relatedAgentProfileId: agentProfileId, relatedMembershipId: m.id, createdById: actor.userId === "system" ? null : actor.userId });
  const updated = await membershipRepository.update(tx, m.id, { seatLedgerEntryId: entry.id });
  await membershipRepository.setProfileAgency(tx, agentProfileId, p.agencyId);
  if (p.emailInviteId) await membershipRepository.updateEmailInvite(tx, p.emailInviteId, { status: "ACCEPTED", acceptedMembershipId: m.id, acceptedAt: new Date() });
  if (p.linkId) await membershipRepository.incrementLinkUses(tx, p.linkId);
  await audit(tx, { actor, action: "AGENCY_MEMBERSHIP_STARTED", entityType: "AgencyMembership", entityId: m.id, newValue: { agencyId: p.agencyId, agentProfileId, status: p.status, source: p.source } });
  await audit(tx, { actor, action: "AGENCY_SEATS_CHANGED", entityType: "AgencySeatLedger", entityId: entry.id, newValue: { agencyId: p.agencyId, changeType: "CONSUMED", quantity: 1, membershipId: m.id } });
  await publishEvent(tx, "AGENCY_MEMBER_JOINED", { agencyId: p.agencyId, agencyName: agency.name, ownerUserId: agency.ownerUserId, membershipId: m.id, agentProfileId, displayName: updated.agentProfile.displayName, status: p.status, source: p.source });
  return updated;
}

/** Ends a membership, releases its seat, and returns the profile to Hirewise Direct. */
export async function endMembershipTx(tx: Db, actor: Actor, m: MemberRecord, p: { reason: string; endedById: string | null }): Promise<void> {
  assertMembershipTransition(m.status as MembershipStatus, "ENDED");
  await membershipRepository.update(tx, m.id, { status: "ENDED", leftAt: new Date(), endReason: p.reason, endedById: p.endedById });
  if (m.seatLedgerEntryId) {
    const entry = await seatRepository.addLedger(tx, { agencyId: m.agencyId!, changeType: "RELEASED", quantity: 1, reason: p.reason, relatedAgentProfileId: m.agentProfileId, relatedMembershipId: m.id, createdById: actor.userId === "system" ? null : actor.userId });
    await audit(tx, { actor, action: "AGENCY_SEATS_CHANGED", entityType: "AgencySeatLedger", entityId: entry.id, newValue: { agencyId: m.agencyId, changeType: "RELEASED", quantity: 1, membershipId: m.id } });
  }
  await membershipRepository.setProfileAgency(tx, m.agentProfileId, null);
  await audit(tx, { actor, action: "AGENCY_MEMBERSHIP_ENDED", entityType: "AgencyMembership", entityId: m.id, previousValue: { status: m.status, agencyId: m.agencyId }, newValue: { status: "ENDED" }, reason: p.reason });
}

/** Email verification completes a join: PENDING_VERIFICATION → ACTIVE. */
export async function activatePendingMemberships(db: PrismaClient, userId: string): Promise<number> {
  const pending = await membershipRepository.pendingVerificationForUser(db, userId);
  if (!pending.length) return 0;
  const actor = systemActor();
  await db.$transaction(async (tx) => {
    for (const m of pending) {
      assertMembershipTransition("PENDING_VERIFICATION", "ACTIVE");
      await membershipRepository.update(tx, m.id, { status: "ACTIVE" });
      await audit(tx, { actor, action: "AGENCY_MEMBERSHIP_ACTIVATED", entityType: "AgencyMembership", entityId: m.id, previousValue: { status: "PENDING_VERIFICATION" }, newValue: { status: "ACTIVE" } });
    }
  });
  return pending.length;
}

/** Worker housekeeping: joins never verified within the configured window give their seat back. */
export async function expireUnverifiedJoins(db: PrismaClient, now = new Date()): Promise<number> {
  const settings = await getSetting(db, "agencySeats");
  const before = new Date(now.getTime() - settings.unverifiedJoinTtlDays * 24 * 60 * 60_000);
  const expired = await membershipRepository.expiredPendingJoins(db, before);
  const actor = systemActor();
  for (const m of expired) {
    await db.$transaction(async (tx) => {
      await endMembershipTx(tx, actor, m, { reason: `Email not verified within ${settings.unverifiedJoinTtlDays} days`, endedById: null });
      await audit(tx, { actor, action: "AGENCY_MEMBERSHIP_EXPIRED", entityType: "AgencyMembership", entityId: m.id, newValue: { agencyId: m.agencyId } });
    });
  }
  return expired.length;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

async function agencyOrThrow(db: Db, agencyId: string) {
  const a = await agencyRepository.findAgency(db, agencyId);
  if (!a) throw new NotFoundError();
  return a;
}

/** Everything the seats screen needs. Agency users see their own agency; staff pass the id. */
export async function seatSummary(db: PrismaClient, actor: Actor, requestedAgencyId?: string) {
  const agencyId = scopedAgencyId(actor, requestedAgencyId, "agency.read");
  const agency = await agencyOrThrow(db, agencyId);
  const [plan, totals, history, requests, purchases, packages, openInvites] = await Promise.all([
    agency.planId ? seatRepository.planById(db, agency.planId) : Promise.resolve(null),
    seatTotals(db, agencyId),
    seatRepository.ledgerHistory(db, agencyId),
    seatRepository.listRequests(db, { agencyId }, 20),
    seatRepository.listPurchases(db, { agencyId }, 20),
    seatRepository.packages(db),
    membershipRepository.openInviteCount(db, agencyId),
  ]);
  return {
    agencyId,
    plan: plan ? toPlanView(plan) : null,
    planStartedAt: agency.planStartedAt,
    totals,
    openInvites,
    /** Seats an invite may still use right now (open email invites reserve capacity, decision 3). */
    invitable: Math.max(0, totals.available - openInvites),
    overCapacity: totals.used > totals.total,
    history: history.map(toLedgerEntryView),
    requests: requests.map(toSeatRequestView),
    purchases: purchases.map(toSeatPurchaseView),
    packages: packages.map(toPackageView),
  };
}
export type SeatSummary = Awaited<ReturnType<typeof seatSummary>>;

/** Members of the agency in any open status (replaces the primaryAgencyId listing for the portal). */
export async function agencyMembers(db: PrismaClient, actor: Actor, requestedAgencyId?: string) {
  const agencyId = scopedAgencyId(actor, requestedAgencyId, "agency.read");
  if (!actor.permissions.has("agency.read")) authorize(actor, "agency.team.read");
  return (await membershipRepository.membersOf(db, agencyId)).map(toMemberView);
}

export async function activePlans(db: Db) {
  return (await seatRepository.plans(db, true)).map(toPlanView);
}
export async function activePackages(db: Db) {
  return (await seatRepository.packages(db, true)).map(toPackageView);
}

// ---------------------------------------------------------------------------
// Admin: capacity, plan, plans and packages
// ---------------------------------------------------------------------------

export const adminSeatChangeSchema = z.object({
  agencyId: z.string().min(1),
  changeType: z.enum(["ADMIN_ADD", "ADMIN_REMOVE", "PROMO_GRANT", "OVERRIDE"]),
  quantity: z.coerce.number().int().min(1).max(10000),
  reason: z.string().trim().min(3, "Give a reason; it is recorded in the ledger and the audit log.").max(500),
  override: z.coerce.boolean().default(false),
});

/** Add, remove, grant, or override seats. Removing below usage needs the override box and never removes agents. */
export async function adminChangeSeats(db: PrismaClient, actor: Actor, raw: z.input<typeof adminSeatChangeSchema>) {
  authorize(actor, "agency.seats.manage");
  const input = adminSeatChangeSchema.parse(raw);
  const agency = await agencyOrThrow(db, input.agencyId);
  const totals = await seatTotals(db, agency.id);
  if (input.changeType === "ADMIN_REMOVE" && totals.total - input.quantity < totals.used && !input.override) {
    throw new ForbiddenError(`Removing ${input.quantity} seat(s) would leave ${totals.total - input.quantity} for ${totals.used} agent(s) in use. Tick "override" with a reason, or remove fewer seats. Agents are never removed automatically.`);
  }
  return db.$transaction(async (tx) => {
    const entry = await seatRepository.addLedger(tx, { agencyId: agency.id, changeType: input.changeType, quantity: input.quantity, reason: input.override && input.changeType === "ADMIN_REMOVE" ? `Override below usage: ${input.reason}` : input.reason, createdById: actor.userId });
    await audit(tx, { actor, action: "AGENCY_SEATS_CHANGED", entityType: "AgencySeatLedger", entityId: entry.id, newValue: { agencyId: agency.id, changeType: input.changeType, quantity: input.quantity, override: input.override }, reason: input.reason });
    const after = await seatTotals(tx, agency.id);
    await publishEvent(tx, "AGENCY_SEATS_CHANGED", { agencyId: agency.id, agencyName: agency.name, ownerUserId: agency.ownerUserId, ownerEmail: agency.owner.email, changeType: input.changeType, quantity: input.quantity, reason: input.reason, total: after.total, available: after.available });
    return after;
  });
}

/** Inside a transaction: reverse the previous base, write the new one, link the plan, and seat members who had none. */
export async function assignPlanTx(tx: Db, actor: Actor, agency: { id: string; name: string; planId: string | null; ownerUserId: string; owner: { email: string } }, plan: { id: string; key: string; name: string; baseAgentSeats: number | null } | null, p: { reason: string; override: boolean }) {
  const ledger = await seatRepository.ledgerSums(tx, agency.id);
  const before = computeTotals(ledger.sums as Partial<Record<LedgerType, number>>, 0, ledger.planReversed);
  const newBase = plan?.baseAgentSeats ?? 0;
  const projected = before.total - before.base + newBase;
  if (projected < before.used && !p.override) throw new ForbiddenError(`${plan ? plan.name : "No plan"} gives ${projected} seat(s) for ${before.used} agent(s) in use. Tick "override" with a reason, or add seats first.`);
  if (before.base > 0) await seatRepository.addLedger(tx, { agencyId: agency.id, changeType: "ADMIN_REMOVE", quantity: before.base, reason: `Plan change: previous base removed (${p.reason})`, planId: agency.planId, createdById: actor.userId === "system" ? null : actor.userId });
  if (newBase > 0) await seatRepository.addLedger(tx, { agencyId: agency.id, changeType: "PLAN_BASE", quantity: newBase, reason: `${plan!.name} plan base seats`, planId: plan!.id, createdById: actor.userId === "system" ? null : actor.userId });
  await seatRepository.setAgencyPlan(tx, agency.id, plan?.id ?? null);
  // Members who joined before any plan existed take their seat now (they may put the agency over capacity, shown as such).
  for (const m of await seatRepository.membershipsWithoutSeat(tx, agency.id)) {
    const entry = await seatRepository.addLedger(tx, { agencyId: agency.id, changeType: "CONSUMED", quantity: 1, reason: "Existing member seated at plan assignment", relatedAgentProfileId: m.agentProfileId, relatedMembershipId: m.id, createdById: actor.userId === "system" ? null : actor.userId });
    await membershipRepository.update(tx, m.id, { seatLedgerEntryId: entry.id });
  }
  await audit(tx, { actor, action: "AGENCY_PLAN_ASSIGNED", entityType: "Agency", entityId: agency.id, previousValue: { planId: agency.planId }, newValue: { planId: plan?.id ?? null, planKey: plan?.key ?? null, baseAgentSeats: newBase }, reason: p.reason });
  const after = await seatTotals(tx, agency.id);
  await publishEvent(tx, "AGENCY_SEATS_CHANGED", { agencyId: agency.id, agencyName: agency.name, ownerUserId: agency.ownerUserId, ownerEmail: agency.owner.email, changeType: "PLAN_BASE", quantity: newBase, reason: plan ? `${plan.name} plan assigned` : "Plan removed", total: after.total, available: after.available });
  return after;
}

export async function assignPlan(db: PrismaClient, actor: Actor, agencyId: string, planKey: string | null, reason: string, override = false) {
  authorize(actor, "agency.seats.manage");
  if (!reason.trim()) throw new ForbiddenError("A reason is required.");
  const agency = await agencyOrThrow(db, agencyId);
  const plan = planKey ? await seatRepository.planByKey(db, planKey) : null;
  if (planKey && (!plan || !plan.isActive)) throw new NotFoundError("Plan not found");
  return db.$transaction((tx) => assignPlanTx(tx, actor, agency, plan, { reason: reason.trim(), override }));
}

export const planSchema = z.object({
  key: z.string().trim().min(2).max(40).regex(/^[A-Z0-9_]+$/, "Use upper-case letters, digits, and underscores."),
  name: z.string().trim().min(2).max(80),
  baseAgentSeats: z.coerce.number().int().min(0).max(10000).nullable(),
  priceMinor: z.coerce.number().int().min(0).max(100_000_000),
  currency: z.string().trim().length(3).toUpperCase().default("USD"),
  billingPeriod: z.enum(["MONTHLY", "ANNUAL"]).default("MONTHLY"),
  trainingAccess: z.coerce.boolean().default(true),
  opportunityAccess: z.coerce.boolean().default(true),
  features: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
  isActive: z.coerce.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(100).default(0),
});

export async function listPlansForAdmin(db: PrismaClient, actor: Actor) {
  authorize(actor, "agency.plans.manage");
  return (await seatRepository.plans(db, false)).map(toPlanView);
}

export async function savePlan(db: PrismaClient, actor: Actor, raw: z.input<typeof planSchema>) {
  authorize(actor, "agency.plans.manage");
  const input = planSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const row = await seatRepository.upsertPlan(tx, input);
    await audit(tx, { actor, action: "PLAN_SAVED", entityType: "Plan", entityId: row.id, newValue: input });
    return toPlanView(row);
  });
}

export const packageSchema = z.object({
  id: z.string().trim().optional().or(z.literal("")),
  name: z.string().trim().min(2).max(80),
  seatCount: z.coerce.number().int().min(1).max(10000),
  priceMinor: z.coerce.number().int().min(0).max(100_000_000),
  currency: z.string().trim().length(3).toUpperCase().default("USD"),
  isActive: z.coerce.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(100).default(0),
});

export async function listPackagesForAdmin(db: PrismaClient, actor: Actor) {
  authorize(actor, "agency.plans.manage");
  return (await seatRepository.packages(db, false)).map(toPackageView);
}

export async function savePackage(db: PrismaClient, actor: Actor, raw: z.input<typeof packageSchema>) {
  authorize(actor, "agency.plans.manage");
  const { id, ...input } = packageSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const row = await seatRepository.savePackage(tx, id || null, input);
    await audit(tx, { actor, action: "SEAT_PACKAGE_SAVED", entityType: "SeatPackage", entityId: row.id, newValue: input });
    return toPackageView(row);
  });
}

// ---------------------------------------------------------------------------
// Seat requests
// ---------------------------------------------------------------------------

export const seatRequestSchema = z.object({
  requestedSeats: z.coerce.number().int().min(1, "Ask for at least one seat.").max(500),
  note: z.string().trim().max(1000).optional().or(z.literal("")),
});

export async function requestSeats(db: PrismaClient, actor: Actor, raw: z.input<typeof seatRequestSchema>) {
  authorize(actor, "agency.billing.manage");
  const agencyId = requireActiveAgency(actor);
  const input = seatRequestSchema.parse(raw);
  const agency = await agencyOrThrow(db, agencyId);
  return db.$transaction(async (tx) => {
    const r = await seatRepository.createRequest(tx, { agencyId, requestedSeats: input.requestedSeats, note: input.note || null, requestedById: actor.userId });
    await audit(tx, { actor, action: "SEAT_REQUEST_SUBMITTED", entityType: "SeatRequest", entityId: r.id, newValue: { agencyId, requestedSeats: input.requestedSeats } });
    await publishEvent(tx, "SEAT_REQUEST_SUBMITTED", { requestId: r.id, agencyId, agencyName: agency.name, requestedSeats: input.requestedSeats, note: input.note || null });
    return toSeatRequestView(r);
  });
}

export const seatDecisionSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  grantedSeats: z.coerce.number().int().min(1).max(10000).optional(),
  note: z.string().trim().max(1000).optional().or(z.literal("")),
});

export async function decideSeatRequest(db: PrismaClient, actor: Actor, id: string, raw: z.input<typeof seatDecisionSchema>) {
  authorize(actor, "agency.seats.manage");
  const input = seatDecisionSchema.parse(raw);
  const r = await seatRepository.findRequest(db, id);
  if (!r) throw new NotFoundError();
  if (r.status !== "PENDING") throw new ForbiddenError("This request was already decided.");
  return db.$transaction(async (tx) => {
    let ledgerEntryId: string | null = null;
    const granted = input.decision === "APPROVE" ? (input.grantedSeats ?? r.requestedSeats) : null;
    if (granted) {
      const entry = await seatRepository.addLedger(tx, { agencyId: r.agencyId, changeType: "ADMIN_ADD", quantity: granted, reason: `Seat request approved${input.note ? `: ${input.note}` : ""}`, createdById: actor.userId });
      ledgerEntryId = entry.id;
      await audit(tx, { actor, action: "AGENCY_SEATS_CHANGED", entityType: "AgencySeatLedger", entityId: entry.id, newValue: { agencyId: r.agencyId, changeType: "ADMIN_ADD", quantity: granted, requestId: r.id } });
    }
    const updated = await seatRepository.decideRequest(tx, r.id, { status: input.decision === "APPROVE" ? "APPROVED" : "REJECTED", reviewedById: actor.userId, decisionNote: input.note || null, grantedSeats: granted, ledgerEntryId });
    await audit(tx, { actor, action: "SEAT_REQUEST_DECIDED", entityType: "SeatRequest", entityId: r.id, previousValue: { status: "PENDING" }, newValue: { status: updated.status, grantedSeats: granted }, reason: input.note || undefined });
    const after = await seatTotals(tx, r.agencyId);
    await publishEvent(tx, "SEAT_REQUEST_DECIDED", { requestId: r.id, agencyId: r.agencyId, agencyName: r.agency.name, ownerUserId: r.agency.ownerUserId, ownerEmail: r.agency.owner.email, decision: updated.status === "APPROVED" ? "APPROVED" : "REJECTED", grantedSeats: granted, note: input.note || null, available: after.available });
    return toSeatRequestView(updated);
  });
}

export async function listSeatRequests(db: PrismaClient, actor: Actor, status?: "PENDING" | "APPROVED" | "REJECTED") {
  authorize(actor, "agency.read");
  const [rows, counts] = await Promise.all([seatRepository.listRequests(db, { status }), seatRepository.requestCounts(db)]);
  return { rows: rows.map(toSeatRequestView), counts };
}

// ---------------------------------------------------------------------------
// Seat packages: purchases recorded by Hirewise (decision 5)
// ---------------------------------------------------------------------------

export async function purchasePackage(db: PrismaClient, actor: Actor, packageId: string, note?: string | null) {
  authorize(actor, "agency.billing.manage");
  const agencyId = requireActiveAgency(actor);
  const pkg = await seatRepository.packageById(db, packageId);
  if (!pkg || !pkg.isActive) throw new NotFoundError("Seat package not found");
  const agency = await agencyOrThrow(db, agencyId);
  return db.$transaction(async (tx) => {
    const p = await seatRepository.createPurchase(tx, { agencyId, packageId: pkg.id, seatCount: pkg.seatCount, amountMinor: pkg.priceMinor, currency: pkg.currency, requestedById: actor.userId, note: note?.trim() || null });
    await audit(tx, { actor, action: "SEAT_PURCHASE_CREATED", entityType: "SeatPurchase", entityId: p.id, newValue: { agencyId, packageId: pkg.id, seatCount: pkg.seatCount, amountMinor: pkg.priceMinor, currency: pkg.currency } });
    await publishEvent(tx, "SEAT_PURCHASE_CREATED", { purchaseId: p.id, agencyId, agencyName: agency.name, seatCount: pkg.seatCount, amountMinor: pkg.priceMinor, currency: pkg.currency });
    return toSeatPurchaseView(p);
  });
}

export const purchaseOutcomeSchema = z.object({
  outcome: z.enum(["PAID", "WAIVED", "CANCELLED"]),
  reference: z.string().trim().max(120).optional().or(z.literal("")),
  note: z.string().trim().max(500).optional().or(z.literal("")),
});

export async function recordSeatPurchase(db: PrismaClient, actor: Actor, id: string, raw: z.input<typeof purchaseOutcomeSchema>) {
  authorize(actor, "agency.seats.manage");
  const input = purchaseOutcomeSchema.parse(raw);
  const p = await seatRepository.findPurchase(db, id);
  if (!p) throw new NotFoundError();
  if (p.status !== "PENDING") throw new ForbiddenError("This purchase was already recorded.");
  if (input.outcome === "PAID" && !input.reference) throw Object.assign(new Error("Enter the payment reference."), { name: "RegistrationError", field: "reference" });
  return db.$transaction(async (tx) => {
    let ledgerEntryId: string | null = null;
    if (input.outcome !== "CANCELLED") {
      const entry = await seatRepository.addLedger(tx, { agencyId: p.agencyId, changeType: "PURCHASE", quantity: p.seatCount, reason: `${p.package.name} (${input.outcome.toLowerCase()}${input.reference ? `, ref ${input.reference}` : ""})`, seatPurchaseId: p.id, createdById: actor.userId });
      ledgerEntryId = entry.id;
      await audit(tx, { actor, action: "AGENCY_SEATS_CHANGED", entityType: "AgencySeatLedger", entityId: entry.id, newValue: { agencyId: p.agencyId, changeType: "PURCHASE", quantity: p.seatCount, purchaseId: p.id } });
    }
    const updated = await seatRepository.recordPurchase(tx, p.id, { status: input.outcome, recordedById: actor.userId, paymentReference: input.reference || null, note: input.note || null, ledgerEntryId, paidAt: input.outcome === "PAID" ? new Date() : null });
    await audit(tx, { actor, action: "SEAT_PURCHASE_RECORDED", entityType: "SeatPurchase", entityId: p.id, previousValue: { status: "PENDING" }, newValue: { status: input.outcome, reference: input.reference || null }, reason: input.note || undefined });
    const after = await seatTotals(tx, p.agencyId);
    await publishEvent(tx, "SEAT_PURCHASE_RECORDED", { purchaseId: p.id, agencyId: p.agencyId, agencyName: p.agency.name, ownerUserId: p.agency.ownerUserId, ownerEmail: p.agency.owner.email, outcome: input.outcome, seatCount: p.seatCount, available: after.available });
    return toSeatPurchaseView(updated);
  });
}

export async function listSeatPurchases(db: PrismaClient, actor: Actor, status?: "PENDING" | "PAID" | "WAIVED" | "CANCELLED") {
  authorize(actor, "agency.read");
  const [rows, counts] = await Promise.all([seatRepository.listPurchases(db, { status }), seatRepository.purchaseCounts(db)]);
  return { rows: rows.map(toSeatPurchaseView), counts };
}
