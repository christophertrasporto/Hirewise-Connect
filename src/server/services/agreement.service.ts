import type { Db, PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import type { RequestMeta } from "@/server/auth/session";
import { agreementRepository } from "@/server/repositories/agreement.repository";
import { audit } from "@/server/audit/audit";
import { NotFoundError } from "@/server/policies/authorize";

export type AgreementSummary = { id: string; type: string; version: number; title: string; bodyMarkdown: string; accepted: boolean };

/** Active agreements the actor's role must accept, with acceptance state (INV-I2). */
export async function agreementsFor(db: Db, actor: Actor): Promise<AgreementSummary[]> {
  if (actor.role !== "CLIENT" && actor.role !== "AGENT") return [];
  const required = await agreementRepository.activeForRole(db, actor.role);
  if (required.length === 0) return [];
  const accepted = new Set((await agreementRepository.acceptedIdsForUser(db, actor.userId, required.map((a) => a.id))).map((a) => a.agreementId));
  return required.map((a) => ({ id: a.id, type: a.type, version: a.version, title: a.title, bodyMarkdown: a.bodyMarkdown, accepted: accepted.has(a.id) }));
}

export async function missingAgreementsFor(db: Db, actor: Actor): Promise<AgreementSummary[]> {
  return (await agreementsFor(db, actor)).filter((a) => !a.accepted);
}

/**
 * Record acceptance of one agreement. Each agreement is accepted individually
 * (not a single checkbox) and the record stores version, checksum, IP, and UA.
 */
export async function acceptAgreement(db: PrismaClient, actor: Actor, agreementId: string, meta: RequestMeta): Promise<void> {
  const agreement = await agreementRepository.findById(db, agreementId);
  if (!agreement || !agreement.isActive || agreement.requiredForRole !== actor.role) throw new NotFoundError("Agreement not found");
  await db.$transaction(async (tx) => {
    await agreementRepository.recordAcceptance(tx, { agreementId, userId: actor.userId, bodyChecksum: agreement.bodyChecksum, ipAddress: meta.ipAddress, userAgent: meta.userAgent });
    await audit(tx, {
      actor,
      action: actor.role === "CLIENT" ? "CLIENT_AGREEMENT_ACCEPTED" : "AGENT_AGREEMENT_ACCEPTED",
      entityType: "Agreement",
      entityId: agreementId,
      newValue: { type: agreement.type, version: agreement.version, checksum: agreement.bodyChecksum },
      ipAddress: meta.ipAddress ?? undefined,
    });
  });
}

export function acceptanceHistory(db: Db, actor: Actor) {
  return agreementRepository.listAcceptancesForUser(db, actor.userId);
}
