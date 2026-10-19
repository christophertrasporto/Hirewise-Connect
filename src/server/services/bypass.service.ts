import { z } from "zod";
import type { Db, PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorize, ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { bypassRepository, type BypassReportRecord } from "@/server/repositories/bypass.repository";
import { agentRepository } from "@/server/repositories/agent.repository";
import { clientRepository } from "@/server/repositories/client.repository";
import { agencyRepository } from "@/server/repositories/agency.repository";
import { audit } from "@/server/audit/audit";
import { publishEvent } from "@/server/events/outbox";
import { getStorage, newStorageKey } from "@/server/adapters/storage";
import { suspendUser } from "@/server/services/incident.service";
import { toBypassReportView } from "@/server/views/bypass.views";

/**
 * Bypass reporting and case management (v2 phase 6a, feature 13, decision 4). Anyone signed in can report a direct
 * contact or bypass attempt; staff with bypass.review work the case through Reported, Under Review, Warning Issued,
 * Restricted, Suspended, Closed. A report alone changes nothing: restrictions and suspensions are explicit staff
 * decisions with a reason, applied through the existing status and suspension paths, every step audited.
 */

export type BypassStatus = "REPORTED" | "UNDER_REVIEW" | "WARNING_ISSUED" | "RESTRICTED" | "SUSPENDED" | "CLOSED";

const TRANSITIONS: Record<BypassStatus, BypassStatus[]> = {
  REPORTED: ["UNDER_REVIEW", "CLOSED"],
  UNDER_REVIEW: ["WARNING_ISSUED", "RESTRICTED", "SUSPENDED", "CLOSED"],
  WARNING_ISSUED: ["RESTRICTED", "SUSPENDED", "CLOSED"],
  RESTRICTED: ["SUSPENDED", "CLOSED"],
  SUSPENDED: ["CLOSED"],
  CLOSED: [],
};

export const bypassReportSchema = z.object({
  description: z.string().trim().min(10, "Describe what happened (at least 10 characters).").max(4000),
  reportedUserId: z.string().optional().or(z.literal("")),
  reportedAgencyId: z.string().optional().or(z.literal("")),
  reportedClientId: z.string().optional().or(z.literal("")),
  relatedType: z.string().max(40).optional().or(z.literal("")),
  relatedId: z.string().max(60).optional().or(z.literal("")),
});

export const bypassDecisionSchema = z.object({
  to: z.enum(["UNDER_REVIEW", "WARNING_ISSUED", "RESTRICTED", "SUSPENDED", "CLOSED"]),
  note: z.string().trim().max(2000).optional().or(z.literal("")),
  restrictionDays: z.coerce.number().int().min(1).max(365).optional(),
  liftRestriction: z.coerce.boolean().optional(),
});

function reportedLabel(r: BypassReportRecord) {
  return r.reportedUser ? (r.reportedUser.agentProfiles[0]?.displayName ?? r.reportedUser.clientContact?.name ?? r.reportedUser.email) : r.reportedAgency?.name ?? r.reportedClient?.companyName ?? "unspecified party";
}

/** Any signed-in client, agent, agency user, or staff member may report. */
export async function reportBypass(db: PrismaClient, actor: Actor, raw: z.input<typeof bypassReportSchema>) {
  const input = bypassReportSchema.parse(raw);
  const reportedUserId = input.reportedUserId || null;
  const reportedAgencyId = input.reportedAgencyId || null;
  const reportedClientId = input.reportedClientId || null;
  if (reportedUserId === actor.userId) throw new Error("You cannot report yourself.");
  return db.$transaction(async (tx) => {
    const r = await bypassRepository.create(tx, { reporterUserId: actor.userId, reporterRole: actor.role, reportedUserId, reportedAgencyId, reportedClientId, relatedType: input.relatedType || null, relatedId: input.relatedId || null, description: input.description });
    await audit(tx, { actor, action: "BYPASS_REPORTED", entityType: "BypassReport", entityId: r.id, newValue: { reportedUserId, reportedAgencyId, reportedClientId, relatedType: input.relatedType || null, relatedId: input.relatedId || null } });
    await publishEvent(tx, "BYPASS_REPORTED", { reportId: r.id, reporterRole: actor.role, reporterUserId: actor.userId, description: input.description.slice(0, 140), reportedLabel: reportedLabel(r) });
    return toBypassReportView(r, "REPORTER");
  });
}

export async function myBypassReports(db: PrismaClient, actor: Actor) {
  return (await bypassRepository.listByReporter(db, actor.userId)).map((r) => toBypassReportView(r, "REPORTER"));
}

export async function listBypassReports(db: PrismaClient, actor: Actor, status?: BypassStatus | "OPEN") {
  authorize(actor, "bypass.review");
  return (await bypassRepository.list(db, status === "OPEN" ? { open: true } : status ? { status } : {})).map((r) => toBypassReportView(r, "STAFF"));
}

export async function getBypassReport(db: PrismaClient, actor: Actor, id: string) {
  const r = await bypassRepository.findById(db, id);
  if (!r) throw new NotFoundError();
  if (actor.permissions.has("bypass.review")) return toBypassReportView(r, "STAFF");
  if (r.reporterUserId !== actor.userId) throw new NotFoundError();
  return toBypassReportView(r, "REPORTER");
}

async function applyRestriction(tx: Db, actor: Actor, r: BypassReportRecord, reason: string) {
  const profile = r.reportedUser?.agentProfiles[0];
  if (profile && profile.status === "APPROVED") {
    await agentRepository.setStatus(tx, profile.id, "HIDDEN", { hiddenAt: new Date() });
    await agentRepository.setAvailability(tx, profile.id, "UNAVAILABLE", { setById: actor.userId, reason });
    await audit(tx, { actor, action: "PROFILE_HIDDEN", entityType: "AgentProfile", entityId: profile.id, previousValue: { status: "APPROVED" }, newValue: { status: "HIDDEN" }, reason });
  }
  const clientId = r.reportedClient?.id ?? r.reportedUser?.clientContact?.clientId ?? null;
  if (clientId) {
    await clientRepository.setStatus(tx, clientId, "SUSPENDED");
    await audit(tx, { actor, action: "CLIENT_STATUS_CHANGED", entityType: "Client", entityId: clientId, newValue: { status: "SUSPENDED" }, reason });
  }
  if (r.reportedAgency && r.reportedAgency.status === "ACTIVE") {
    await agencyRepository.updateAgency(tx, r.reportedAgency.id, { status: "SUSPENDED", statusReason: reason, suspendedAt: new Date() });
    await audit(tx, { actor, action: "AGENCY_STATUS_CHANGED", entityType: "Agency", entityId: r.reportedAgency.id, previousValue: { status: "ACTIVE" }, newValue: { status: "SUSPENDED" }, reason });
  }
}

async function liftRestriction(tx: Db, actor: Actor, r: BypassReportRecord, reason: string) {
  const profile = r.reportedUser?.agentProfiles[0];
  if (profile && profile.status === "HIDDEN") {
    await agentRepository.setStatus(tx, profile.id, "APPROVED", { hiddenAt: null });
    await agentRepository.setAvailability(tx, profile.id, "AVAILABLE", { setById: actor.userId, reason });
    await audit(tx, { actor, action: "PROFILE_APPROVED", entityType: "AgentProfile", entityId: profile.id, previousValue: { status: "HIDDEN" }, newValue: { status: "APPROVED" }, reason });
  }
  const clientId = r.reportedClient?.id ?? r.reportedUser?.clientContact?.clientId ?? null;
  if (clientId && (r.reportedClient?.status ?? "SUSPENDED") === "SUSPENDED") {
    await clientRepository.setStatus(tx, clientId, "ACTIVE");
    await audit(tx, { actor, action: "CLIENT_STATUS_CHANGED", entityType: "Client", entityId: clientId, newValue: { status: "ACTIVE" }, reason });
  }
  if (r.reportedAgency && r.reportedAgency.status === "SUSPENDED") {
    await agencyRepository.updateAgency(tx, r.reportedAgency.id, { status: "ACTIVE", statusReason: null, suspendedAt: null });
    await audit(tx, { actor, action: "AGENCY_STATUS_CHANGED", entityType: "Agency", entityId: r.reportedAgency.id, previousValue: { status: "SUSPENDED" }, newValue: { status: "ACTIVE" }, reason });
  }
}

/** Staff decision. Warning notifies; Restricted hides or suspends the reported party's access with an end date; Suspended uses the user suspension path; Closed may lift a restriction. */
export async function decideBypass(db: PrismaClient, actor: Actor, id: string, raw: z.input<typeof bypassDecisionSchema>) {
  authorize(actor, "bypass.review");
  const input = bypassDecisionSchema.parse(raw);
  const r = await bypassRepository.findById(db, id);
  if (!r) throw new NotFoundError();
  const from = r.status as BypassStatus;
  if (!TRANSITIONS[from].includes(input.to)) throw new Error(`A ${from.toLowerCase().replace(/_/g, " ")} case cannot move to ${input.to.toLowerCase().replace(/_/g, " ")}.`);
  const note = input.note?.trim() || null;
  if (input.to !== "UNDER_REVIEW" && !note) throw new Error("A decision note is required.");
  if ((input.to === "RESTRICTED" || input.to === "SUSPENDED") && !r.reportedUser && !r.reportedAgency && !r.reportedClient) throw new Error("Name the reported party before restricting or suspending.");
  if (input.to === "SUSPENDED") {
    if (!r.reportedUser) throw new Error("Suspension applies to a user account; name the reported user.");
    if (!actor.permissions.has("user.manage")) throw new ForbiddenError("Suspending an account needs user.manage; ask an Admin.");
  }
  const restrictionEndsAt = input.to === "RESTRICTED" ? new Date(Date.now() + (input.restrictionDays ?? 30) * 86_400_000) : undefined;
  const updated = await db.$transaction(async (tx) => {
    if (input.to === "RESTRICTED") await applyRestriction(tx, actor, r, `Bypass case ${r.id}: ${note}`);
    if (input.to === "CLOSED" && input.liftRestriction && (from === "RESTRICTED" || from === "SUSPENDED")) await liftRestriction(tx, actor, r, `Bypass case ${r.id} closed: ${note}`);
    const u = await bypassRepository.transition(tx, r.id, { from, to: input.to, byUserId: actor.userId, note, decisionNotes: input.to === "UNDER_REVIEW" ? undefined : note, restrictionEndsAt, assignedToUserId: input.to === "UNDER_REVIEW" ? actor.userId : undefined });
    await audit(tx, { actor, action: "BYPASS_STATUS_CHANGED", entityType: "BypassReport", entityId: r.id, previousValue: { status: from }, newValue: { status: input.to, restrictionEndsAt: restrictionEndsAt ?? null, lifted: !!input.liftRestriction }, reason: note ?? undefined });
    if (input.to !== "UNDER_REVIEW") await publishEvent(tx, "BYPASS_DECIDED", { reportId: r.id, status: input.to, reporterUserId: r.reporterUserId, reportedUserId: r.reportedUser?.id ?? null, reportedOwnerUserId: r.reportedAgency?.ownerUserId ?? null, note });
    return u;
  });
  // Suspension goes through the shared path so the audit trail and notifications match other suspensions.
  if (input.to === "SUSPENDED" && r.reportedUser) await suspendUser(db, actor, r.reportedUser.id, `Bypass case ${r.id}: ${note}`);
  return toBypassReportView(updated, "STAFF");
}

export async function bypassEvidenceUploadUrl(db: PrismaClient, actor: Actor, reportId: string, contentType: string) {
  const r = await bypassRepository.findById(db, reportId);
  if (!r) throw new NotFoundError();
  if (r.reporterUserId !== actor.userId && !actor.permissions.has("bypass.review")) throw new NotFoundError();
  if (r.status === "CLOSED") throw new Error("This case is closed.");
  const ext = ({ "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "text/plain": "txt" } as Record<string, string>)[contentType];
  if (!ext) throw new Error("Evidence must be a PDF, PNG, JPEG, or text file.");
  const key = newStorageKey(`bypass/${r.id}`, ext);
  return { key, ...(await getStorage().createUploadUrl(key, contentType)) };
}

export async function attachBypassEvidence(db: PrismaClient, actor: Actor, reportId: string, storageKey: string) {
  const r = await bypassRepository.findById(db, reportId);
  if (!r) throw new NotFoundError();
  if (r.reporterUserId !== actor.userId && !actor.permissions.has("bypass.review")) throw new NotFoundError();
  if (!storageKey.startsWith(`bypass/${r.id}/`)) throw new ForbiddenError("Storage key does not belong to this case");
  if (!(await getStorage().exists(storageKey))) throw new Error("The file was not uploaded.");
  await db.$transaction(async (tx) => {
    const doc = await tx.document.create({ data: { ownerType: "BYPASS_REPORT", ownerId: r.id, kind: "BYPASS_EVIDENCE", storageKey, uploadedById: actor.userId, visibility: "INTERNAL" } });
    await bypassRepository.addEvidence(tx, r.id, doc.id);
    await audit(tx, { actor, action: "BYPASS_EVIDENCE_ADDED", entityType: "BypassReport", entityId: r.id, newValue: { documentId: doc.id } });
  });
}

export async function bypassEvidenceUrl(db: PrismaClient, actor: Actor, reportId: string, documentId: string) {
  const r = await bypassRepository.findById(db, reportId);
  if (!r || !r.evidenceDocumentIds.includes(documentId)) throw new NotFoundError();
  if (r.reporterUserId !== actor.userId && !actor.permissions.has("bypass.review")) throw new NotFoundError();
  const doc = await db.document.findUnique({ where: { id: documentId } });
  if (!doc) throw new NotFoundError();
  return getStorage().createDownloadUrl(doc.storageKey);
}
