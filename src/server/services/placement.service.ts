import { createHash } from "node:crypto";
import type { Db, PrismaClient, Tx } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import type { RequestMeta } from "@/server/auth/session";
import { authorize, ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { assertClientOwns } from "@/server/policies/ownership";
import { placementRepository } from "@/server/repositories/placement.repository";
import { billingRepository } from "@/server/repositories/billing.repository";
import { rateRepository } from "@/server/repositories/rate.repository";
import { agentRepository } from "@/server/repositories/agent.repository";
import { reservationRepository } from "@/server/repositories/reservation.repository";
import { audit } from "@/server/audit/audit";
import { publishEvent } from "@/server/events/outbox";
import { assertPlacementTransition, computeDeposit, DEPLOYMENT_CHECKLIST_TEMPLATE, type PlacementStatus } from "@/server/state/placement";
import { toPlacementView } from "@/server/views/interview.views";
import { toPlacementAgentView, toPlacementClientView, toPlacementStaffView, money, rateLabel } from "@/server/views/commercial.views";
import { getSetting } from "./setting.service";
import { issueInvoice } from "./billing.service";
import { getStorage } from "@/server/adapters/storage";

/**
 * Placement pipeline — Section 5.5 with every guard, Section 8.6 side effects.
 * SELECTED (Phase 2) → AWAITING_AGREEMENT → AWAITING_DEPOSIT → DEPLOYMENT_PREP → ACTIVE ↔ PAUSED → COMPLETED; CANCELLED with a reason.
 */

export async function createPlacementFromSelection(tx: Tx, actor: Actor, p: { clientId: string; agentProfileId: string; requirementId: string | null; interviewRequestId: string; interviewId: string; positionTitle: string; schedule: string | null; timezone: string | null; startDate: Date | null; accountManagerUserId: string | null }) {
  const existing = await placementRepository.findOpenForPair(tx, p.clientId, p.agentProfileId);
  if (existing) return existing;
  void actor;
  return placementRepository.create(tx, p);
}

async function load(db: Db, id: string) {
  const p = await placementRepository.findById(db, id);
  if (!p) throw new NotFoundError();
  return p;
}

/** Staff read: placement.read_all, or the assigned Sales rep for their own clients. */
function assertStaffRead(actor: Actor, p: { clientId: string }) {
  // Sales reps see placements for their assigned clients only, whatever the catalog grants (same rule as assertClientOwns).
  if (actor.role === "SALES") {
    if (actor.salesAssignedClientIds?.includes(p.clientId)) return;
    throw new ForbiddenError("This client is not assigned to you");
  }
  if (actor.permissions.has("placement.read_all")) return;
  throw new ForbiddenError("Placement access requires placement.read_all", "placement.read_all");
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listPlacementsForClient(db: PrismaClient, actor: Actor) {
  if (actor.role !== "CLIENT" || !actor.clientId) return [];
  return (await placementRepository.listForClient(db, actor.clientId)).map((p) => toPlacementView(p, "CLIENT"));
}

export async function listPlacementsForAgent(db: PrismaClient, actor: Actor) {
  if (actor.role !== "AGENT" || !actor.agentProfileId) return [];
  return (await placementRepository.listForAgent(db, actor.agentProfileId)).map((p) => toPlacementView(p, "AGENT"));
}

export async function listPlacementsForStaff(db: PrismaClient, actor: Actor, status?: PlacementStatus) {
  authorize(actor, "placement.read_all");
  return (await placementRepository.listForStaff(db, status)).map((p) => toPlacementView(p, "STAFF"));
}

export async function getPlacementForClient(db: PrismaClient, actor: Actor, id: string) {
  const p = await load(db, id);
  assertClientOwns(actor, p);
  return toPlacementClientView(p);
}

export async function getPlacementForAgent(db: PrismaClient, actor: Actor, id: string) {
  const p = await load(db, id);
  if (actor.role !== "AGENT" || actor.agentProfileId !== p.agentProfileId) throw new NotFoundError();
  return toPlacementAgentView(p);
}

export async function getPlacementForStaff(db: PrismaClient, actor: Actor, id: string) {
  const p = await load(db, id);
  assertStaffRead(actor, p);
  return toPlacementStaffView(p, { canSeeCompensation: actor.permissions.has("compensation.read"), canSeeBillingRate: actor.permissions.has("billing_rate.read") });
}

// ---------------------------------------------------------------------------
// SELECTED → AWAITING_AGREEMENT ("Hirewise Approval")
// ---------------------------------------------------------------------------

/**
 * Requires placement.approve and a PUBLISHED billing rate for the agent, which is snapshotted
 * along with the current compensation (restricted ref). Creates the deposit from the chosen or
 * default policy and issues the deposit invoice.
 */
export async function approvePlacement(db: PrismaClient, actor: Actor, id: string, opts: { depositPolicyId?: string | null; customDepositUsd?: string | null; startDate?: string | null } = {}) {
  const p = await load(db, id);
  assertPlacementTransition(actor, p, "AWAITING_AGREEMENT");
  const rate = await rateRepository.publishedForAgent(db, p.agentProfileId);
  if (!rate) throw new Error("A PUBLISHED client billing rate is required before Hirewise approval. Propose and publish one from the agent's profile.");
  const policy = opts.depositPolicyId ? await billingRepository.findPolicy(db, opts.depositPolicyId) : await billingRepository.defaultPolicy(db);
  if (!policy || !policy.isActive) throw new Error("No active deposit policy. Configure one under Commercial settings.");
  const hours = await getSetting(db, "hoursPerMonthDefault");
  const deposit = computeDeposit(policy, rate, hours, opts.customDepositUsd ? Math.round(Number(opts.customDepositUsd) * 100) : null);
  const comp = await rateRepository.currentCompensation(db, p.agentProfileId);
  const startDate = opts.startDate ? new Date(opts.startDate) : p.startDate;

  await db.$transaction(async (tx) => {
    await placementRepository.setStatus(tx, p.id, "AWAITING_AGREEMENT", { approvedById: actor.userId, clientBillingRateId: rate.id, agentCompensationId: comp?.id ?? null, ...(startDate ? { startDate } : {}) });
    const dueDate = new Date(Date.now() + 7 * 86_400_000);
    const dep = await billingRepository.createDeposit(tx, { placementId: p.id, policyId: policy.id, requiredAmount: deposit.amount, currency: deposit.currency, dueDate, approvedById: actor.userId });
    const inv = await issueInvoice(tx, actor, { clientId: p.clientId, placementId: p.id, depositId: dep.id, description: `Placement deposit (${policy.name}) for ${p.agentProfile.displayName} - ${p.positionTitle}`, amount: deposit.amount, currency: deposit.currency, dueAt: dueDate });
    await audit(tx, { actor, action: "PLACEMENT_APPROVED", entityType: "Placement", entityId: p.id, previousValue: { status: p.status }, newValue: { status: "AWAITING_AGREEMENT", clientBillingRateId: rate.id, depositId: dep.id, invoiceId: inv.id, requiredAmount: deposit.amount } });
    await publishEvent(tx, "PLACEMENT_APPROVED", { placementId: p.id, clientUserId: p.client.contacts[0]?.userId ?? null, clientEmail: p.client.contacts[0]?.businessEmail ?? null, companyName: p.client.companyName, displayName: p.agentProfile.displayName, positionTitle: p.positionTitle, salesUserId: p.accountManagerUserId, rateLabel: rateLabel(rate), depositLabel: money(deposit.amount, deposit.currency) });
  });
}

// ---------------------------------------------------------------------------
// AWAITING_AGREEMENT → AWAITING_DEPOSIT (service agreement)
// ---------------------------------------------------------------------------

/** The PLACEMENT_SERVICE_AGREEMENT template with placeholders filled (Section 8.6). */
export async function serviceAgreementFor(db: PrismaClient, actor: Actor, placementId: string) {
  const p = await load(db, placementId);
  if (actor.role === "CLIENT") assertClientOwns(actor, p);
  else assertStaffRead(actor, p);
  const template = await db.agreement.findFirst({ where: { type: "PLACEMENT_SERVICE_AGREEMENT", isActive: true }, orderBy: { version: "desc" } });
  if (!template) throw new Error("No active Placement Service Agreement template. Seed or create one first.");
  const rate = p.clientBillingRate ? rateLabel(p.clientBillingRate) : "as published by Hirewise";
  const body = template.bodyMarkdown
    .replace(/\{\{\s*companyName\s*\}\}/g, p.client.companyName)
    .replace(/\{\{\s*agentName\s*\}\}/g, p.agentProfile.displayName)
    .replace(/\{\{\s*positionTitle\s*\}\}/g, p.positionTitle)
    .replace(/\{\{\s*schedule\s*\}\}/g, p.schedule ?? "as agreed")
    .replace(/\{\{\s*billingRate\s*\}\}/g, rate)
    .replace(/\{\{\s*deposit\s*\}\}/g, p.deposit ? money(p.deposit.requiredAmount, p.deposit.currency) : "per the deposit policy")
    .replace(/\{\{\s*startDate\s*\}\}/g, p.startDate ? p.startDate.toISOString().slice(0, 10) : "to be confirmed");
  const summary = [`**Client:** ${p.client.companyName}`, `**Talent:** ${p.agentProfile.displayName}`, `**Position:** ${p.positionTitle}`, `**Schedule:** ${p.schedule ?? "as agreed"}`, `**Client billing rate:** ${rate}`, `**Deposit:** ${p.deposit ? money(p.deposit.requiredAmount, p.deposit.currency) : "per policy"}`, `**Start date:** ${p.startDate ? p.startDate.toISOString().slice(0, 10) : "to be confirmed"}`].join("\n\n");
  const rendered = `${summary}\n\n---\n\n${body}`;
  return { agreementId: template.id, version: template.version, title: template.title, bodyMarkdown: rendered, checksum: createHash("sha256").update(rendered).digest("hex"), accepted: !!p.agreementAcceptedAt, status: p.status };
}

/** Client click-accepts the rendered agreement (Section 14 Q9). Records the acceptance with placementId. */
export async function acceptServiceAgreement(db: PrismaClient, actor: Actor, placementId: string, meta: RequestMeta) {
  const p = await load(db, placementId);
  assertClientOwns(actor, p);
  assertPlacementTransition(actor, p, "AWAITING_DEPOSIT");
  const rendered = await serviceAgreementFor(db, actor, placementId);
  await db.$transaction(async (tx) => {
    const existing = await tx.agreementAcceptance.findFirst({ where: { agreementId: rendered.agreementId, userId: actor.userId, placementId: p.id } });
    if (!existing) await tx.agreementAcceptance.create({ data: { agreementId: rendered.agreementId, userId: actor.userId, placementId: p.id, bodyChecksum: rendered.checksum, ipAddress: meta.ipAddress ?? undefined, userAgent: meta.userAgent ?? undefined } });
    await placementRepository.setStatus(tx, p.id, "AWAITING_DEPOSIT", { agreementAcceptedAt: new Date() });
    await audit(tx, { actor, action: "CLIENT_AGREEMENT_ACCEPTED", entityType: "Placement", entityId: p.id, newValue: { agreementId: rendered.agreementId, version: rendered.version, checksum: rendered.checksum }, ipAddress: meta.ipAddress ?? undefined });
    await audit(tx, { actor, action: "PLACEMENT_STATUS_CHANGED", entityType: "Placement", entityId: p.id, previousValue: { status: p.status }, newValue: { status: "AWAITING_DEPOSIT" } });
    await emitDepositRequired(tx, p);
  });
}

/** Staff record a signed PDF instead of click-acceptance (Q9). The key must be under placements/<id>/. */
export async function recordSignedAgreement(db: PrismaClient, actor: Actor, placementId: string, storageKey: string) {
  const p = await load(db, placementId);
  assertPlacementTransition(actor, p, "AWAITING_DEPOSIT");
  if (!storageKey.startsWith(`placements/${p.id}/`)) throw new ForbiddenError("Storage key does not belong to this placement");
  if (!(await getStorage().exists(storageKey))) throw new Error("The signed agreement was not uploaded.");
  await db.$transaction(async (tx) => {
    await tx.document.create({ data: { ownerType: "PLACEMENT", ownerId: p.id, kind: "SIGNED_AGREEMENT", storageKey, uploadedById: actor.userId, visibility: "CLIENT" } });
    await placementRepository.setStatus(tx, p.id, "AWAITING_DEPOSIT", { agreementAcceptedAt: new Date(), signedAgreementKey: storageKey });
    await audit(tx, { actor, action: "PLACEMENT_STATUS_CHANGED", entityType: "Placement", entityId: p.id, previousValue: { status: p.status }, newValue: { status: "AWAITING_DEPOSIT", signedAgreementKey: storageKey } });
    await emitDepositRequired(tx, p);
  });
}

export async function signedAgreementUploadUrl(db: PrismaClient, actor: Actor, placementId: string, contentType: string) {
  const p = await load(db, placementId);
  assertPlacementTransition(actor, p, "AWAITING_DEPOSIT");
  if (contentType !== "application/pdf") throw new Error("Upload a PDF.");
  const key = `placements/${p.id}/signed-agreement-${Date.now()}.pdf`;
  const upload = await getStorage().createUploadUrl(key, contentType);
  return { key, ...upload };
}

async function emitDepositRequired(tx: Db, p: Awaited<ReturnType<typeof load>>) {
  const dep = await billingRepository.depositForPlacement(tx, p.id);
  const inv = dep?.invoices.find((i) => i.status === "ISSUED");
  if (!dep || !inv) return;
  await publishEvent(tx, "DEPOSIT_REQUIRED", { placementId: p.id, clientUserId: p.client.contacts[0]?.userId ?? null, clientEmail: p.client.contacts[0]?.businessEmail ?? null, companyName: p.client.companyName, invoiceNumber: inv.number, amount: dep.requiredAmount, currency: dep.currency, dueAt: dep.dueDate.toISOString(), displayName: p.agentProfile.displayName });
}

// ---------------------------------------------------------------------------
// AWAITING_DEPOSIT → DEPLOYMENT_PREP (system, called by billing.service)
// ---------------------------------------------------------------------------

export async function onDepositSettled(tx: Db, actor: Actor, placementId: string, how: "PAID" | "WAIVED") {
  const p = await load(tx, placementId);
  if (p.status !== "AWAITING_DEPOSIT") return; // paid early or late: the guard at activation still applies
  assertPlacementTransition(actor, p, "DEPLOYMENT_PREP", undefined, true);
  await placementRepository.setStatus(tx, p.id, "DEPLOYMENT_PREP");
  if (p.checklistItems.length === 0) await billingRepository.createChecklist(tx, p.id, DEPLOYMENT_CHECKLIST_TEMPLATE);
  await audit(tx, { actor, action: "PLACEMENT_STATUS_CHANGED", entityType: "Placement", entityId: p.id, previousValue: { status: p.status }, newValue: { status: "DEPLOYMENT_PREP", deposit: how } });
  await publishEvent(tx, "DEPOSIT_PAID", { placementId: p.id, how, clientUserId: p.client.contacts[0]?.userId ?? null, clientEmail: p.client.contacts[0]?.businessEmail ?? null, companyName: p.client.companyName, agentUserId: p.agentProfile.userId, agentEmail: p.agentProfile.user.email, displayName: p.agentProfile.displayName, salesUserId: p.accountManagerUserId });
}

// ---------------------------------------------------------------------------
// DEPLOYMENT_PREP: checklist, start date → ACTIVE
// ---------------------------------------------------------------------------

export async function setChecklistItem(db: PrismaClient, actor: Actor, itemId: string, done: boolean) {
  if (!actor.permissions.has("placement.manage") && !actor.permissions.has("placement.activate")) throw new ForbiddenError("Checklist requires placement.manage or placement.activate");
  const item = await billingRepository.findChecklistItem(db, itemId);
  if (!item) throw new NotFoundError();
  if (item.placement.status !== "DEPLOYMENT_PREP") throw new Error("The checklist is editable only during deployment preparation.");
  await billingRepository.setChecklistItem(db, item.id, done, actor.userId);
}

export async function setStartDate(db: PrismaClient, actor: Actor, placementId: string, startDate: string) {
  authorize(actor, "placement.manage");
  const p = await load(db, placementId);
  const d = new Date(startDate);
  if (Number.isNaN(d.getTime())) throw new Error("Invalid start date.");
  await db.$transaction(async (tx) => {
    await placementRepository.update(tx, p.id, { startDate: d });
    await audit(tx, { actor, action: "PLACEMENT_UPDATED", entityType: "Placement", entityId: p.id, previousValue: { startDate: p.startDate }, newValue: { startDate: d } });
  });
}

/**
 * DEPLOYMENT_PREP → ACTIVE. Requires placement.activate, every required checklist item done,
 * a start date, and (INV-C5, re-checked here for every role) a PAID or WAIVED deposit.
 */
export async function activatePlacement(db: PrismaClient, actor: Actor, placementId: string) {
  const p = await load(db, placementId);
  assertPlacementTransition(actor, p, "ACTIVE");
  const deposit = await billingRepository.depositForPlacement(db, p.id);
  if (!deposit || (deposit.status !== "PAID" && deposit.status !== "WAIVED")) throw new DepositUnpaidError();
  const missing = p.checklistItems.filter((c) => c.isRequired && !c.isDone);
  if (missing.length) throw new Error(`Complete the required checklist first: ${missing.map((m) => m.label).join("; ")}`);
  if (!p.startDate) throw new Error("Set the start date before activating.");
  await db.$transaction(async (tx) => {
    await placementRepository.setStatus(tx, p.id, "ACTIVE", { activatedAt: new Date() });
    await agentRepository.setAvailability(tx, p.agentProfileId, "PLACED", { setById: actor.userId, reason: `Deployed to ${p.client.companyName}` });
    const hold = await reservationRepository.activeForAgent(tx, p.agentProfileId);
    if (hold) await reservationRepository.setStatus(tx, hold.id, "CONVERTED");
    await audit(tx, { actor, action: "PLACEMENT_ACTIVATED", entityType: "Placement", entityId: p.id, previousValue: { status: p.status }, newValue: { status: "ACTIVE", startDate: p.startDate, deposit: deposit.status } });
    await publishEvent(tx, "CANDIDATE_DEPLOYED", { placementId: p.id, clientUserId: p.client.contacts[0]?.userId ?? null, clientEmail: p.client.contacts[0]?.businessEmail ?? null, companyName: p.client.companyName, agentUserId: p.agentProfile.userId, agentEmail: p.agentProfile.user.email, displayName: p.agentProfile.displayName, positionTitle: p.positionTitle, startDate: p.startDate!.toISOString(), salesUserId: p.accountManagerUserId });
  });
}

export class DepositUnpaidError extends Error {
  readonly status = 409;
  constructor() {
    super("The deposit must be PAID or WAIVED before activation (INV-C5). Waiving requires deposit.override and a reason.");
    this.name = "DepositUnpaidError";
  }
}

// ---------------------------------------------------------------------------
// ACTIVE ↔ PAUSED, → COMPLETED, → CANCELLED
// ---------------------------------------------------------------------------

export async function transitionPlacement(db: PrismaClient, actor: Actor, placementId: string, to: "PAUSED" | "ACTIVE" | "COMPLETED" | "CANCELLED", reason?: string) {
  const p = await load(db, placementId);
  assertPlacementTransition(actor, p, to, reason);
  await db.$transaction(async (tx) => {
    const now = new Date();
    if (to === "PAUSED") await placementRepository.setStatus(tx, p.id, "PAUSED", { pausedAt: now });
    else if (to === "ACTIVE") await placementRepository.setStatus(tx, p.id, "ACTIVE", { pausedAt: null });
    else if (to === "COMPLETED") await placementRepository.setStatus(tx, p.id, "COMPLETED", { endedAt: now, endReason: reason });
    else await placementRepository.setStatus(tx, p.id, "CANCELLED", { endedAt: now, cancelledReason: reason });

    if (to === "COMPLETED" || to === "CANCELLED") {
      const hold = await reservationRepository.activeForAgent(tx, p.agentProfileId);
      if (hold) await reservationRepository.setStatus(tx, hold.id, "RELEASED");
      const current = await agentRepository.availabilityOf(tx, p.agentProfileId);
      if (current === "PLACED" || current === "RESERVED") await agentRepository.setAvailability(tx, p.agentProfileId, "AVAILABLE", { setById: actor.userId, reason: `Placement ${to.toLowerCase()}` });
    }
    await audit(tx, { actor, action: "PLACEMENT_STATUS_CHANGED", entityType: "Placement", entityId: p.id, previousValue: { status: p.status }, newValue: { status: to }, reason });
    await publishEvent(tx, "PLACEMENT_STATUS_CHANGED", { placementId: p.id, status: to, reason: reason ?? null, clientUserId: p.client.contacts[0]?.userId ?? null, companyName: p.client.companyName, agentUserId: p.agentProfile.userId, displayName: p.agentProfile.displayName, positionTitle: p.positionTitle, salesUserId: p.accountManagerUserId });
  });
}
