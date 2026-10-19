import type { Db, PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { systemActor } from "@/server/auth/actor";
import { authorize } from "@/server/policies/authorize";
import { aliasRepository } from "@/server/repositories/alias.repository";
import { userRepository } from "@/server/repositories/user.repository";
import { audit } from "@/server/audit/audit";
import { getSetting } from "@/server/services/setting.service";

/**
 * Email aliases (v2 phase 6a, decision 3). `talent1028@hirewiseconnect.com` and `team1029@…` stand in for every real
 * address on client-facing views. Allocation and display ship now; inbound routing is designed in
 * `handleInboundEmail` and stays off until `email.inboundEnabled` is turned on with a provider webhook.
 */

export type AliasOwnerType = "AGENT_PROFILE" | "AGENCY" | "CLIENT";
const PREFIX: Record<AliasOwnerType, string> = { AGENT_PROFILE: "talent", AGENCY: "team", CLIENT: "client" };

/** Finds or allocates the alias for one owner. Idempotent. */
export async function aliasFor(db: Db, ownerType: AliasOwnerType, ownerId: string, actor: Actor = systemActor()): Promise<string> {
  const existing = await aliasRepository.find(db, ownerType, ownerId);
  if (existing) return existing.alias;
  const domain = (await getSetting(db, "email")).aliasDomain;
  const n = await aliasRepository.nextNumber(db);
  const created = await aliasRepository.create(db, { alias: `${PREFIX[ownerType]}${n}@${domain}`, ownerType, ownerId, routingTarget: null });
  await audit(db, { actor, action: "ALIAS_ALLOCATED", entityType: "EmailAlias", entityId: created.id, newValue: { alias: created.alias, ownerType, ownerId } });
  return created.alias;
}

/** Alias to show a client for a candidate, or null when the profile has none yet. Never a real address. */
export async function contactAliasFor(db: Db, ownerType: AliasOwnerType, ownerId: string): Promise<string | null> {
  return (await aliasRepository.find(db, ownerType, ownerId))?.alias ?? null;
}

/** Maintenance: every approved agent and active agency holds an alias. */
export async function allocateMissingAliases(db: Db): Promise<number> {
  const missing = await aliasRepository.missing(db);
  for (const id of missing.agents) await aliasFor(db, "AGENT_PROFILE", id);
  for (const id of missing.agencies) await aliasFor(db, "AGENCY", id);
  return missing.agents.length + missing.agencies.length;
}

export async function listAliases(db: PrismaClient, actor: Actor) {
  authorize(actor, "thread.moderate");
  return (await aliasRepository.list(db)).map((a) => ({ id: a.id, alias: a.alias, ownerType: a.ownerType, ownerId: a.ownerId, active: a.active, createdAt: a.createdAt }));
}

export type InboundEmail = { to: string; from: string; subject: string | null; text: string };

/**
 * Inbound routing design: the provider posts a signed JSON body to /api/inbound/email; the alias in `to` names the
 * owner, the sender must be a known platform user, and the text is posted into that owner's open support thread
 * through the same masking rules as any message. Disabled by `email.inboundEnabled` until a provider delivers to it.
 */
export async function handleInboundEmail(db: PrismaClient, mail: InboundEmail): Promise<{ accepted: boolean; reason: string; threadId?: string }> {
  const settings = await getSetting(db, "email");
  if (!settings.inboundEnabled) return { accepted: false, reason: "inbound routing disabled" };
  const alias = await aliasRepository.findByAlias(db, mail.to.trim().toLowerCase());
  if (!alias || !alias.active) return { accepted: false, reason: "unknown alias" };
  const sender = await userRepository.findByEmail(db, mail.from.trim().toLowerCase());
  const actor = systemActor();
  if (!sender) {
    await audit(db, { actor, action: "INBOUND_EMAIL_RECEIVED", entityType: "EmailAlias", entityId: alias.id, newValue: { accepted: false, reason: "unknown sender" } });
    return { accepted: false, reason: "unknown sender" };
  }
  const { resolveActor } = await import("@/server/auth/resolve-actor");
  const { openSupportThread, postToThread } = await import("@/server/services/thread.service");
  const senderActor = await resolveActor(db, sender.id);
  const thread = await openSupportThread(db, senderActor, { agentProfileId: alias.ownerType === "AGENT_PROFILE" ? alias.ownerId : null, agencyId: alias.ownerType === "AGENCY" ? alias.ownerId : null, title: mail.subject?.trim() || `Email to ${alias.alias}` });
  const posted = await postToThread(db, senderActor, thread.id, mail.text.trim().slice(0, 4000));
  await audit(db, { actor, action: "INBOUND_EMAIL_RECEIVED", entityType: "EmailAlias", entityId: alias.id, newValue: { accepted: true, threadId: thread.id, messageId: posted.id, masked: posted.masked, held: posted.held } });
  return { accepted: true, reason: "posted", threadId: thread.id };
}
