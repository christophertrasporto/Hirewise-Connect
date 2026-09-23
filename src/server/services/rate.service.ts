import { z } from "zod";
import type { PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorize, ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { rateRepository } from "@/server/repositories/rate.repository";
import { agentRepository } from "@/server/repositories/agent.repository";
import { audit } from "@/server/audit/audit";
import { publishEvent } from "@/server/events/outbox";
import { recomputeVerification } from "./verification.service";

/**
 * Client billing rates and agent compensation (Section 4.7, INV-C1..C4).
 * The two tables are handled by separate functions with separate permissions and
 * are never returned together.
 */

export function usdToCents(v: string): number {
  return Math.round(Number(v) * 100);
}

export function money(cents: number, currency: string) {
  return `${currency} ${(cents / 100).toFixed(2)}`;
}

const amountSchema = z.string().trim().regex(/^\d{1,6}(\.\d{1,2})?$/, "Enter an amount like 9 or 9.50");

export const billingRateSchema = z.object({
  agentProfileId: z.string().min(1),
  amountUsd: amountSchema,
  currency: z.string().trim().length(3).default("USD"),
  unit: z.enum(["HOURLY", "MONTHLY"]),
  positioningNotes: z.string().trim().max(2000).optional().or(z.literal("")),
});

export const compensationSchema = z.object({
  agentProfileId: z.string().min(1),
  amountUsd: amountSchema,
  currency: z.string().trim().length(3).default("USD"),
  unit: z.enum(["HOURLY", "MONTHLY"]),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

// ---------------------------------------------------------------------------
// Client billing rates
// ---------------------------------------------------------------------------

/** Sales proposes (footnote 7); Admin may propose too. Always lands in PENDING_APPROVAL (INV-C3). */
export async function proposeBillingRate(db: PrismaClient, actor: Actor, input: z.infer<typeof billingRateSchema>) {
  authorize(actor, "billing_rate.propose");
  const profile = await agentRepository.findByIdForStaff(db, input.agentProfileId);
  if (!profile) throw new NotFoundError();
  if (profile.status !== "APPROVED") throw new Error("Only approved profiles can carry a client rate.");
  const amount = usdToCents(input.amountUsd);
  const currency = input.currency.toUpperCase();
  return db.$transaction(async (tx) => {
    const current = await rateRepository.publishedForAgent(tx, profile.id);
    const rate = await rateRepository.createBillingRate(tx, { agentProfileId: profile.id, amount, currency, unit: input.unit, proposedById: actor.userId, effectiveFrom: new Date(), positioningNotes: input.positioningNotes || null, status: "PENDING_APPROVAL" });
    await rateRepository.addHistory(tx, { subjectType: "CLIENT_BILLING_RATE", subjectId: rate.id, agentProfileId: profile.id, previousAmount: current?.amount ?? null, newAmount: amount, currency, unit: input.unit, previousStatus: current ? "PUBLISHED" : null, newStatus: "PENDING_APPROVAL", changedById: actor.userId, reason: "Proposed" });
    await audit(tx, { actor, action: "BILLING_RATE_PROPOSED", entityType: "ClientBillingRate", entityId: rate.id, newValue: { agentProfileId: profile.id, amount, currency, unit: input.unit } });
    await publishEvent(tx, "BILLING_RATE_PROPOSED", { rateId: rate.id, agentProfileId: profile.id, displayName: profile.displayName, proposedByUserId: actor.userId, amount, currency, unit: input.unit });
    return rate.id;
  });
}

/** Admin publishes or rejects. Publishing retires the previous published rate (INV-C3, INV-C4). */
export async function decideBillingRate(db: PrismaClient, actor: Actor, rateId: string, decision: "PUBLISH" | "REJECT", reason?: string) {
  authorize(actor, "billing_rate.approve");
  const rate = await rateRepository.findBillingRate(db, rateId);
  if (!rate) throw new NotFoundError();
  if (rate.status !== "PENDING_APPROVAL") throw new Error("Only pending proposals can be decided.");
  if (decision === "REJECT" && !reason?.trim()) throw new Error("A reason is required to reject.");
  await db.$transaction(async (tx) => {
    if (decision === "PUBLISH") {
      const current = await rateRepository.publishedForAgent(tx, rate.agentProfileId);
      if (current) {
        await rateRepository.setBillingRateStatus(tx, current.id, "RETIRED", { effectiveTo: new Date(), decisionReason: `Superseded by ${rate.id}` });
        await rateRepository.addHistory(tx, { subjectType: "CLIENT_BILLING_RATE", subjectId: current.id, agentProfileId: rate.agentProfileId, previousAmount: current.amount, newAmount: current.amount, currency: current.currency, unit: current.unit, previousStatus: "PUBLISHED", newStatus: "RETIRED", changedById: actor.userId, reason: "Superseded" });
      }
      await rateRepository.setBillingRateStatus(tx, rate.id, "PUBLISHED", { approvedById: actor.userId, decisionReason: reason?.trim() || undefined });
      await rateRepository.addHistory(tx, { subjectType: "CLIENT_BILLING_RATE", subjectId: rate.id, agentProfileId: rate.agentProfileId, previousAmount: current?.amount ?? null, newAmount: rate.amount, currency: rate.currency, unit: rate.unit, previousStatus: "PENDING_APPROVAL", newStatus: "PUBLISHED", changedById: actor.userId, reason: reason?.trim() || "Published" });
      await audit(tx, { actor, action: "BILLING_RATE_PUBLISHED", entityType: "ClientBillingRate", entityId: rate.id, previousValue: current ? { amount: current.amount, rateId: current.id } : null, newValue: { amount: rate.amount, currency: rate.currency, unit: rate.unit }, reason });
      await publishEvent(tx, "BILLING_RATE_PUBLISHED", { rateId: rate.id, agentProfileId: rate.agentProfileId, agentUserId: rate.agentProfile.userId, displayName: rate.agentProfile.displayName, proposedByUserId: rate.proposedById });
      await recomputeVerification(tx, rate.agentProfileId, actor);
    } else {
      await rateRepository.setBillingRateStatus(tx, rate.id, "RETIRED", { effectiveTo: new Date(), decisionReason: reason });
      await rateRepository.addHistory(tx, { subjectType: "CLIENT_BILLING_RATE", subjectId: rate.id, agentProfileId: rate.agentProfileId, previousAmount: rate.amount, newAmount: rate.amount, currency: rate.currency, unit: rate.unit, previousStatus: "PENDING_APPROVAL", newStatus: "RETIRED", changedById: actor.userId, reason: reason ?? null });
      await audit(tx, { actor, action: "BILLING_RATE_REJECTED", entityType: "ClientBillingRate", entityId: rate.id, reason });
      await publishEvent(tx, "BILLING_RATE_REJECTED", { rateId: rate.id, displayName: rate.agentProfile.displayName, proposedByUserId: rate.proposedById, reason: reason ?? "" });
    }
  });
}

export async function retireBillingRate(db: PrismaClient, actor: Actor, rateId: string, reason: string) {
  authorize(actor, "billing_rate.approve");
  if (!reason.trim()) throw new Error("A reason is required.");
  const rate = await rateRepository.findBillingRate(db, rateId);
  if (!rate || rate.status !== "PUBLISHED") throw new NotFoundError();
  await db.$transaction(async (tx) => {
    await rateRepository.setBillingRateStatus(tx, rate.id, "RETIRED", { effectiveTo: new Date(), decisionReason: reason });
    await rateRepository.addHistory(tx, { subjectType: "CLIENT_BILLING_RATE", subjectId: rate.id, agentProfileId: rate.agentProfileId, previousAmount: rate.amount, newAmount: rate.amount, currency: rate.currency, unit: rate.unit, previousStatus: "PUBLISHED", newStatus: "RETIRED", changedById: actor.userId, reason });
    await audit(tx, { actor, action: "BILLING_RATE_RETIRED", entityType: "ClientBillingRate", entityId: rate.id, reason });
    await recomputeVerification(tx, rate.agentProfileId, actor);
  });
}

/**
 * Staff view of an agent's billing rates. Sales (billing_rate.read without approve)
 * sees the published rate and pending proposals only: no history, no positioning notes.
 */
export async function billingRatesForAgent(db: PrismaClient, actor: Actor, agentProfileId: string) {
  authorize(actor, "billing_rate.read");
  const full = actor.permissions.has("billing_rate.approve");
  const rows = await rateRepository.listForAgent(db, agentProfileId);
  const published = rows.find((r) => r.status === "PUBLISHED") ?? null;
  const pending = rows.filter((r) => r.status === "PENDING_APPROVAL");
  const view = (r: (typeof rows)[number]) => ({ id: r.id, amount: r.amount, currency: r.currency, unit: r.unit, status: r.status, proposedBy: r.proposedBy.email, approvedBy: r.approvedBy?.email ?? null, effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo, createdAt: r.createdAt, positioningNotes: full ? r.positioningNotes : null, decisionReason: full ? r.decisionReason : null });
  return {
    published: published ? view(published) : null,
    pending: pending.map(view),
    history: full ? (await rateRepository.history(db, "CLIENT_BILLING_RATE", agentProfileId)).map((h) => ({ id: h.id, previousAmount: h.previousAmount, newAmount: h.newAmount, currency: h.currency, unit: h.unit, previousStatus: h.previousStatus, newStatus: h.newStatus, changedBy: h.changedBy.email, reason: h.reason, changedAt: h.changedAt })) : [],
    all: full ? rows.map(view) : [],
  };
}

export async function listPendingBillingRates(db: PrismaClient, actor: Actor) {
  authorize(actor, "billing_rate.approve");
  return rateRepository.listPending(db);
}

// ---------------------------------------------------------------------------
// Agent compensation (Super Admin, or Admin with a compensation.* override)
// ---------------------------------------------------------------------------

export async function setCompensation(db: PrismaClient, actor: Actor, input: z.infer<typeof compensationSchema>, reason?: string) {
  authorize(actor, "compensation.write");
  const profile = await agentRepository.findByIdForStaff(db, input.agentProfileId);
  if (!profile) throw new NotFoundError();
  const amount = usdToCents(input.amountUsd);
  const currency = input.currency.toUpperCase();
  return db.$transaction(async (tx) => {
    const now = new Date();
    const current = await rateRepository.currentCompensation(tx, profile.id);
    if (current) await rateRepository.endCompensation(tx, current.id, now);
    const comp = await rateRepository.createCompensation(tx, { agentProfileId: profile.id, amount, currency, unit: input.unit, setById: actor.userId, effectiveFrom: now, notes: input.notes || null });
    await rateRepository.addHistory(tx, { subjectType: "AGENT_COMPENSATION", subjectId: comp.id, agentProfileId: profile.id, previousAmount: current?.amount ?? null, newAmount: amount, currency, unit: input.unit, previousStatus: current ? "CURRENT" : null, newStatus: "CURRENT", changedById: actor.userId, reason: reason?.trim() || null });
    await audit(tx, { actor, action: "COMPENSATION_SET", entityType: "AgentCompensation", entityId: comp.id, previousValue: current ? { amount: current.amount, currency: current.currency, unit: current.unit } : null, newValue: { amount, currency, unit: input.unit }, reason });
    return comp.id;
  });
}

/** Current compensation: the agent for their own profile, or a holder of compensation.read. */
export async function currentCompensationFor(db: PrismaClient, actor: Actor, agentProfileId: string) {
  const own = actor.role === "AGENT" && actor.agentProfileId === agentProfileId;
  if (!own && !actor.permissions.has("compensation.read")) throw new ForbiddenError("Compensation requires compensation.read", "compensation.read");
  const c = await rateRepository.currentCompensation(db, agentProfileId);
  return c ? { id: c.id, amount: c.amount, currency: c.currency, unit: c.unit, effectiveFrom: c.effectiveFrom, notes: own ? null : c.notes } : null;
}

export async function compensationHistoryFor(db: PrismaClient, actor: Actor, agentProfileId: string) {
  authorize(actor, "compensation.read");
  const [rows, history] = await Promise.all([rateRepository.listCompensation(db, agentProfileId), rateRepository.history(db, "AGENT_COMPENSATION", agentProfileId)]);
  return {
    records: rows.map((r) => ({ id: r.id, amount: r.amount, currency: r.currency, unit: r.unit, effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo, setBy: r.setBy.email, notes: r.notes })),
    history: history.map((h) => ({ id: h.id, previousAmount: h.previousAmount, newAmount: h.newAmount, currency: h.currency, unit: h.unit, changedBy: h.changedBy.email, reason: h.reason, changedAt: h.changedAt })),
  };
}

/** Agent-facing flag only (Section 14 Q4, INV-C2): whether a published client rate exists. */
export async function clientRatePublishedFor(db: PrismaClient, agentProfileId: string): Promise<boolean> {
  return !!(await rateRepository.publishedForAgent(db, agentProfileId));
}
