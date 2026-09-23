import type { PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { ForbiddenError } from "@/server/policies/authorize";
import { audit } from "@/server/audit/audit";

/**
 * Client data export (Section 13 Phase 5: "data export for clients (own data)").
 * Returns everything the client can already see in the portal, in one JSON document.
 * Nothing internal (sales notes, positioning notes, compensation) is included.
 */
export async function exportClientData(db: PrismaClient, actor: Actor) {
  if (actor.role !== "CLIENT" || !actor.clientId) throw new ForbiddenError("Export is for client accounts");
  const clientId = actor.clientId;
  const [client, requirements, shortlists, requests, placements, invoices, acceptances, savedSearches] = await Promise.all([
    db.client.findUniqueOrThrow({ where: { id: clientId }, select: { companyName: true, industry: true, website: true, country: true, timezone: true, status: true, createdAt: true, contacts: { select: { name: true, position: true, businessEmail: true, phone: true, isPrimary: true } }, onboarding: { select: { servicesNeeded: true, agentsRequired: true, preferredSchedule: true, expectedStartDate: true, notes: true } } } }),
    db.clientRequirement.findMany({ where: { clientId }, select: { id: true, title: true, role: true, jobDescription: true, skills: true, industry: true, experienceLevel: true, agentsRequired: true, schedule: true, timezone: true, software: true, startDate: true, budgetMin: true, budgetMax: true, currency: true, otherRequirements: true, status: true, createdAt: true } }),
    db.shortlist.findMany({ where: { clientId }, select: { name: true, createdAt: true, candidates: { where: { removedAt: null }, select: { note: true, addedAt: true, agentProfile: { select: { displayName: true, primaryRole: true } } } } } }),
    db.interviewRequest.findMany({ where: { clientId }, select: { id: true, role: true, schedule: true, timezone: true, preferredDate: true, preferredTime: true, notes: true, status: true, createdAt: true, candidates: { select: { status: true, agentProfile: { select: { displayName: true } } } }, interviews: { select: { round: true, scheduledAt: true, timezone: true, durationMin: true, status: true, clientDecision: true, clientFeedback: true, agentProfile: { select: { displayName: true } } } }, messages: { where: { visibleTo: { in: ["ALL", "CLIENT_AND_HIREWISE"] }, heldForReview: false }, select: { authorRole: true, body: true, createdAt: true } } } }),
    db.placement.findMany({ where: { clientId }, select: { id: true, positionTitle: true, schedule: true, timezone: true, startDate: true, status: true, activatedAt: true, endedAt: true, createdAt: true, agreementAcceptedAt: true, agentProfile: { select: { displayName: true, primaryRole: true } }, clientBillingRate: { select: { amount: true, currency: true, unit: true } }, deposit: { select: { requiredAmount: true, currency: true, dueDate: true, status: true } } } }),
    db.invoice.findMany({ where: { clientId }, select: { number: true, description: true, amount: true, currency: true, status: true, issuedAt: true, dueAt: true, paidAt: true, payments: { select: { amount: true, currency: true, method: true, reference: true, paidAt: true } } } }),
    db.agreementAcceptance.findMany({ where: { userId: actor.userId }, select: { acceptedAt: true, bodyChecksum: true, placementId: true, agreement: { select: { type: true, version: true, title: true } } } }),
    db.savedSearch.findMany({ where: { clientId }, select: { name: true, filters: true, createdAt: true } }),
  ]);
  await audit(db, { actor, action: "DATA_EXPORTED", entityType: "Client", entityId: clientId, newValue: { requirements: requirements.length, placements: placements.length, invoices: invoices.length } });
  return { exportedAt: new Date().toISOString(), client, requirements, shortlists, interviewRequests: requests, placements, invoices, agreementAcceptances: acceptances, savedSearches };
}
