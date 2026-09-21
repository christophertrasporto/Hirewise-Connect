import { z } from "zod";
import type { PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorize, ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { assertClientOwns } from "@/server/policies/ownership";
import { shortlistRepository } from "@/server/repositories/shortlist.repository";
import { agentRepository } from "@/server/repositories/agent.repository";
import { clientRepository } from "@/server/repositories/client.repository";
import { audit } from "@/server/audit/audit";
import { publishEvent } from "@/server/events/outbox";
import { toCandidateCardView, toCandidateClientView } from "@/server/views/agent.views";
import { assertMarketplaceAccess } from "./search.service";

export const noteSchema = z.string().trim().max(1000);

async function ownDefaultList(db: PrismaClient, actor: Actor) {
  const access = await assertMarketplaceAccess(db, actor);
  if (!access.clientId) throw new ForbiddenError("Only clients keep shortlists");
  return shortlistRepository.defaultForClient(db, access.clientId, actor.userId);
}

/** Section 8.4. Adds an APPROVED candidate; idempotent; audited; introduction logged. */
export async function addToShortlist(db: PrismaClient, actor: Actor, agentProfileId: string) {
  const list = await ownDefaultList(db, actor);
  const p = await agentRepository.findApprovedById(db, agentProfileId);
  if (!p) throw new NotFoundError();
  if (await shortlistRepository.activeEntry(db, list.id, p.id)) return;
  const client = await clientRepository.findById(db, list.clientId);
  await db.$transaction(async (tx) => {
    await shortlistRepository.add(tx, list.id, p.id, actor.userId);
    await shortlistRepository.upsertIntroduction(tx, list.clientId, p.id, "SHORTLIST");
    await audit(tx, { actor, action: "CANDIDATE_SHORTLISTED", entityType: "AgentProfile", entityId: p.id, newValue: { shortlistId: list.id, clientId: list.clientId } });
    await publishEvent(tx, "CANDIDATE_SHORTLISTED", { clientId: list.clientId, companyName: client?.companyName ?? "Client", agentProfileId: p.id, displayName: p.displayName, accountManagerUserId: client?.accountManagerUserId ?? null });
  });
}

export async function removeFromShortlist(db: PrismaClient, actor: Actor, agentProfileId: string) {
  const list = await ownDefaultList(db, actor);
  await shortlistRepository.remove(db, list.id, agentProfileId);
}

export async function setShortlistNote(db: PrismaClient, actor: Actor, agentProfileId: string, note: string) {
  const list = await ownDefaultList(db, actor);
  await shortlistRepository.setNote(db, list.id, agentProfileId, noteSchema.parse(note) || null);
}

export async function getOwnShortlist(db: PrismaClient, actor: Actor) {
  const list = await ownDefaultList(db, actor);
  const entries = await shortlistRepository.activeEntries(db, list.id);
  return {
    id: list.id,
    name: list.name,
    candidates: entries.filter((e) => e.agentProfile.status === "APPROVED").map((e) => ({ ...toCandidateCardView(e.agentProfile), note: e.note, addedAt: e.addedAt })),
  };
}

/** Side-by-side comparison of up to four shortlisted candidates (Section 8.4). */
export async function compareShortlisted(db: PrismaClient, actor: Actor, ids: string[]) {
  const list = await ownDefaultList(db, actor);
  const entries = await shortlistRepository.activeEntries(db, list.id);
  const allowed = new Set(entries.map((e) => e.agentProfileId));
  const chosen = ids.filter((id) => allowed.has(id)).slice(0, 4);
  const rows = await agentRepository.findManyApproved(db, chosen);
  return chosen.map((id) => rows.find((r) => r.id === id)).filter(Boolean).map((r) => toCandidateClientView(r!));
}

/** Staff: a shortlist by id, scoped to the actor (client owner, assigned Sales, or shortlist.read_all). */
export async function getShortlistForStaff(db: PrismaClient, actor: Actor, shortlistId: string) {
  const list = await shortlistRepository.findById(db, shortlistId);
  assertClientOwns(actor, list, "shortlist.read_all");
  const entries = await shortlistRepository.activeEntries(db, list.id);
  return { id: list.id, clientId: list.clientId, name: list.name, candidates: entries.map((e) => ({ ...toCandidateCardView(e.agentProfile), note: e.note, addedAt: e.addedAt })) };
}

/** Sales sees shortlist activity for assigned clients; admins and ops see all (Section 8.4). */
export async function shortlistActivityForStaff(db: PrismaClient, actor: Actor) {
  authorize(actor, "shortlist.read_all");
  const scope = actor.role === "SALES" ? [...(actor.salesAssignedClientIds ?? [])] : null;
  const rows = await shortlistRepository.recentActivity(db, scope);
  return rows.map((r) => ({
    id: r.id,
    addedAt: r.addedAt,
    removedAt: r.removedAt,
    note: r.note,
    client: { id: r.shortlist.client.id, companyName: r.shortlist.client.companyName, managed: r.shortlist.client.accountManagerUserId === actor.userId },
    agent: { id: r.agentProfile.id, displayName: r.agentProfile.displayName, primaryRole: r.agentProfile.primaryRole, availabilityStatus: r.agentProfile.availabilityStatus },
  }));
}
