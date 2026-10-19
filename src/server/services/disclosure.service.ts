import { z } from "zod";
import type { Db, PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorize, NotFoundError } from "@/server/policies/authorize";
import { disclosureRepository } from "@/server/repositories/disclosure.repository";
import { clientRepository } from "@/server/repositories/client.repository";
import { audit } from "@/server/audit/audit";
import { publishEvent } from "@/server/events/outbox";
import { getSetting } from "@/server/services/setting.service";
import { toDisclosureGrantView } from "@/server/views/partner.views";

/**
 * Disclosure grants (v2 phase 5, decision 6). Identities cross the Hirewise boundary only through an active grant:
 * AGENT_IDENTITY (client sees the agent's full name), AGENCY_IDENTITY (client sees the real agency behind a Partner
 * Team), CLIENT_IDENTITY (talent sees the client's company name). Staff grant and revoke; the system grants at
 * interview scheduling and placement per the `disclosure` setting.
 */

export type DisclosureScope = "AGENT_IDENTITY" | "AGENCY_IDENTITY" | "CLIENT_IDENTITY";

export const grantSchema = z.object({
  scope: z.enum(["AGENT_IDENTITY", "AGENCY_IDENTITY", "CLIENT_IDENTITY"]),
  clientId: z.string().min(1, "Choose a client."),
  agentProfileId: z.string().optional().or(z.literal("")),
  agencyId: z.string().optional().or(z.literal("")),
  reason: z.string().trim().min(3, "Give a reason.").max(500),
});

function subjectFor(scope: DisclosureScope, agentProfileId: string | null, agencyId: string | null) {
  if (scope === "AGENCY_IDENTITY") {
    if (!agencyId) throw new Error("An agency is required for an agency identity grant.");
    return { agentProfileId: null, agencyId };
  }
  if (!agentProfileId) throw new Error("An agent is required for this grant.");
  return { agentProfileId, agencyId: null };
}

/** Idempotent: an existing active grant for the same scope and subject is returned, not duplicated. */
async function grantTx(tx: Db, actor: Actor, d: { scope: DisclosureScope; clientId: string; agentProfileId: string | null; agencyId: string | null; grantedBy: "STAFF" | "SYSTEM"; reason: string; interviewId?: string | null }) {
  const subject = subjectFor(d.scope, d.agentProfileId, d.agencyId);
  const existing = await disclosureRepository.active(tx, { scope: d.scope, clientId: d.clientId, ...subject });
  if (existing) return { grant: existing, created: false };
  const grant = await disclosureRepository.create(tx, { scope: d.scope, clientId: d.clientId, ...subject, grantedBy: d.grantedBy, grantedById: d.grantedBy === "STAFF" ? actor.userId : null, reason: d.reason, interviewId: d.interviewId ?? null });
  await audit(tx, { actor, action: "DISCLOSURE_GRANTED", entityType: "DisclosureGrant", entityId: grant.id, newValue: { scope: d.scope, clientId: d.clientId, ...subject, grantedBy: d.grantedBy, interviewId: d.interviewId ?? null }, reason: d.reason });
  await publishEvent(tx, "DISCLOSURE_CHANGED", { grantId: grant.id, scope: d.scope, action: "GRANTED", clientId: d.clientId, companyName: grant.client.companyName, subjectLabel: grant.agentProfile?.displayName ?? grant.agency?.name ?? "", accountManagerUserId: (await clientRepository.findById(tx, d.clientId))?.accountManagerUserId ?? null, grantedBy: d.grantedBy });
  return { grant, created: true };
}

/** Staff grant (disclosure.manage). */
export async function grantDisclosure(db: PrismaClient, actor: Actor, raw: z.input<typeof grantSchema>) {
  authorize(actor, "disclosure.manage");
  const input = grantSchema.parse(raw);
  const client = await clientRepository.findById(db, input.clientId);
  if (!client) throw new NotFoundError();
  return db.$transaction(async (tx) => {
    const r = await grantTx(tx, actor, { scope: input.scope, clientId: input.clientId, agentProfileId: input.agentProfileId || null, agencyId: input.agencyId || null, grantedBy: "STAFF", reason: input.reason });
    return toDisclosureGrantView(r.grant);
  });
}

export async function revokeDisclosure(db: PrismaClient, actor: Actor, grantId: string, reason: string) {
  authorize(actor, "disclosure.manage");
  if (!reason.trim()) throw new Error("A reason is required to revoke a disclosure.");
  const g = await disclosureRepository.findById(db, grantId);
  if (!g) throw new NotFoundError();
  if (g.revokedAt) return toDisclosureGrantView(g);
  return db.$transaction(async (tx) => {
    const revoked = await disclosureRepository.revoke(tx, g.id, { revokedById: actor.userId, revokeReason: reason.trim() });
    await audit(tx, { actor, action: "DISCLOSURE_REVOKED", entityType: "DisclosureGrant", entityId: g.id, previousValue: { scope: g.scope, clientId: g.clientId }, newValue: { revokedAt: revoked.revokedAt }, reason });
    await publishEvent(tx, "DISCLOSURE_CHANGED", { grantId: g.id, scope: g.scope, action: "REVOKED", clientId: g.clientId, companyName: g.client.companyName, subjectLabel: g.agentProfile?.displayName ?? g.agency?.name ?? "", accountManagerUserId: (await clientRepository.findById(tx, g.clientId))?.accountManagerUserId ?? null, grantedBy: "STAFF" });
    return toDisclosureGrantView(revoked);
  });
}

export async function listGrants(db: PrismaClient, actor: Actor, q: { agentProfileId?: string; agencyId?: string; clientId?: string }) {
  authorize(actor, "disclosure.manage");
  return (await disclosureRepository.listFor(db, q)).map(toDisclosureGrantView);
}

/** System grants when an interview is scheduled, per the `disclosure` setting. Runs inside the scheduling transaction. */
export async function grantsAtSchedulingTx(tx: Db, actor: Actor, d: { clientId: string; agentProfileId: string; interviewId: string; isAgencyAgent: boolean }) {
  const s = await getSetting(tx, "disclosure");
  const reason = "Interview scheduled";
  if (s.agentIdentityAt === "INTERVIEW_SCHEDULED") await grantTx(tx, actor, { scope: "AGENT_IDENTITY", clientId: d.clientId, agentProfileId: d.agentProfileId, agencyId: null, grantedBy: "SYSTEM", reason, interviewId: d.interviewId });
  const clientRule = d.isAgencyAgent ? s.clientIdentityForAgencyAgents : s.clientIdentityForDirectTalent;
  if (clientRule === "INTERVIEW_SCHEDULED") await grantTx(tx, actor, { scope: "CLIENT_IDENTITY", clientId: d.clientId, agentProfileId: d.agentProfileId, agencyId: null, grantedBy: "SYSTEM", reason, interviewId: d.interviewId });
}

/** A placement means both sides work together: both identities are disclosed (decision 6). */
export async function grantsAtPlacementTx(tx: Db, actor: Actor, d: { clientId: string; agentProfileId: string; placementId: string }) {
  const reason = `Placement created (${d.placementId})`;
  await grantTx(tx, actor, { scope: "AGENT_IDENTITY", clientId: d.clientId, agentProfileId: d.agentProfileId, agencyId: null, grantedBy: "SYSTEM", reason });
  await grantTx(tx, actor, { scope: "CLIENT_IDENTITY", clientId: d.clientId, agentProfileId: d.agentProfileId, agencyId: null, grantedBy: "SYSTEM", reason });
}

/** Agent profile ids whose full identity this client may see. */
export function agentIdentityDisclosedTo(db: Db, clientId: string) {
  return disclosureRepository.activeSubjectsForClient(db, clientId, "AGENT_IDENTITY");
}

/** Agency ids whose real identity this client may see. */
export function agencyIdentityDisclosedTo(db: Db, clientId: string) {
  return disclosureRepository.activeSubjectsForClient(db, clientId, "AGENCY_IDENTITY");
}

/** Client ids whose company name this agent may see. */
export function clientIdentityDisclosedTo(db: Db, agentProfileId: string) {
  return disclosureRepository.activeClientsForAgent(db, agentProfileId);
}
