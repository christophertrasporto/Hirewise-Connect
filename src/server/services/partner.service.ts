import { z } from "zod";
import { contactAliasFor } from "@/server/services/alias.service";
import type { Db, PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorize, ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { partnerRepository, type PartnerTeamRecord } from "@/server/repositories/partner.repository";
import { audit } from "@/server/audit/audit";
import { assertMarketplaceAccess } from "@/server/services/search.service";
import { agencyIdentityDisclosedTo } from "@/server/services/disclosure.service";
import { clientSafeContextFor } from "@/server/services/client-safe-document.service";
import { toPartnerTeamClientView, computeTeamStats, type PartnerTeamClientView } from "@/server/views/partner.views";
import { toCandidateCardView } from "@/server/views/agent.views";

/**
 * Client-facing Partner Team identity (v2 phase 5, feature 8). The code and default name are assigned by the system
 * when an agency is created; only Hirewise edits the name and specializations. Clients receive the allow-list in
 * `partner.views.ts` and nothing else about an agency.
 */

export function defaultPartnerName(code: string) {
  return `Hirewise Certified Partner Team ${code}`;
}

/** Called inside provisioning (approval or direct creation). */
export async function assignPartnerIdentityTx(tx: Db, actor: Actor, agencyId: string) {
  const code = await partnerRepository.allocateCode(tx);
  const name = defaultPartnerName(code);
  await partnerRepository.setClientFacing(tx, agencyId, { clientFacingCode: code, clientFacingName: name });
  await audit(tx, { actor, action: "PARTNER_IDENTITY_ASSIGNED", entityType: "Agency", entityId: agencyId, newValue: { clientFacingCode: code, clientFacingName: name } });
  return { code, name };
}

export const partnerIdentitySchema = z.object({
  clientFacingName: z.string().trim().min(3, "Give the team a name.").max(120),
  specializations: z.string().trim().max(600).optional().or(z.literal("")),
});

/** Hirewise edits the client-facing name and specializations. The name must not reveal the real agency. */
export async function updatePartnerIdentity(db: PrismaClient, actor: Actor, agencyId: string, raw: z.input<typeof partnerIdentitySchema>) {
  authorize(actor, "partner.identity.manage");
  const input = partnerIdentitySchema.parse(raw);
  const a = await partnerRepository.findById(db, agencyId);
  if (!a) throw new NotFoundError();
  const real = a.name.trim().toLowerCase();
  if (real.length >= 3 && input.clientFacingName.toLowerCase().includes(real)) throw new Error("The client-facing name must not contain the agency's real name.");
  const specializations = (input.specializations ?? "").split(/[,\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 12);
  await db.$transaction(async (tx) => {
    await partnerRepository.updateClientFacing(tx, a.id, { clientFacingName: input.clientFacingName, clientFacingSpecializations: specializations });
    await audit(tx, { actor, action: "PARTNER_IDENTITY_UPDATED", entityType: "Agency", entityId: a.id, previousValue: { clientFacingName: a.clientFacingName, specializations: a.clientFacingSpecializations }, newValue: { clientFacingName: input.clientFacingName, specializations } });
  });
}

/** Rejects any attempt by an agency user to write client-facing fields through the profile form or API. */
export function assertNoClientFacingKeys(raw: Record<string, unknown>) {
  const offending = Object.keys(raw).filter((k) => k.toLowerCase().startsWith("clientfacing"));
  if (offending.length) throw new ForbiddenError("The client-facing identity is managed by Hirewise.");
}

async function teamView(db: Db, team: PartnerTeamRecord, disclosed: boolean): Promise<PartnerTeamClientView> {
  const members = await partnerRepository.memberStats(db, team.id);
  return toPartnerTeamClientView(team, computeTeamStats(members), disclosed ? await partnerRepository.findById(db, team.id).then((a) => (a ? { name: a.name } : null)) : null, await contactAliasFor(db, "AGENCY", team.id));
}

/** Partner Teams a client may browse. Staff with marketplace access see the same list. */
export async function partnerTeamsForClient(db: PrismaClient, actor: Actor) {
  const access = await assertMarketplaceAccess(db, actor);
  const disclosed = access.clientId ? await agencyIdentityDisclosedTo(db, access.clientId) : new Set<string>();
  const teams = await partnerRepository.listVisible(db);
  return Promise.all(teams.map((t) => teamView(db, t, disclosed.has(t.id))));
}

/** One Partner Team with its approved members as client-safe cards. Unknown or hidden teams are NotFound. */
export async function partnerTeamForClient(db: PrismaClient, actor: Actor, code: string) {
  const access = await assertMarketplaceAccess(db, actor);
  const team = await partnerRepository.findByCode(db, code.trim().toUpperCase());
  if (!team || team.status !== "ACTIVE" || !team.opportunityAccess) throw new NotFoundError();
  const disclosed = access.clientId ? (await agencyIdentityDisclosedTo(db, access.clientId)).has(team.id) : false;
  const members = await partnerRepository.approvedMembers(db, team.id);
  if (members.length === 0) throw new NotFoundError();
  const ctx = await clientSafeContextFor(db, members.map((m) => m.id));
  return { team: await teamView(db, team, disclosed), members: members.map((m) => toCandidateCardView(m, { audience: "CLIENT", clientSafe: ctx.get(m.id) })) };
}

/** Staff: both identities side by side. */
export async function partnerIdentityForStaff(db: PrismaClient, actor: Actor, agencyId: string) {
  authorize(actor, "agency.read");
  const a = await partnerRepository.findById(db, agencyId);
  if (!a) throw new NotFoundError();
  const stats = computeTeamStats(await partnerRepository.memberStats(db, agencyId));
  return { code: a.clientFacingCode, name: a.clientFacingName ?? (a.clientFacingCode ? defaultPartnerName(a.clientFacingCode) : null), specializations: a.clientFacingSpecializations, realName: a.name, visibleToClients: a.status === "ACTIVE" && a.opportunityAccess && stats.teamSize > 0, stats };
}
