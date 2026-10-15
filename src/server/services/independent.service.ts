import { z } from "zod";
import type { PrismaClient, Db } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import type { RequestMeta } from "@/server/auth/session";
import { authorize, ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { independentRepository } from "@/server/repositories/independent.repository";
import { membershipRepository } from "@/server/repositories/membership.repository";
import { audit } from "@/server/audit/audit";
import { publishEvent } from "@/server/events/outbox";
import { getSetting } from "@/server/services/setting.service";
import { acceptTermsTx, requireTermsAccepted } from "@/server/services/terms.service";
import { formatMoney } from "@/server/views/seat.views";

/**
 * Independent reapplication (v2 phase 4): a former agency agent returns as an independent freelancer with a fresh
 * profile. Blocked while any membership is open or ending. Agency-sponsored credentials never follow.
 */

export type IndependentEligibility = { eligible: boolean; reason: string | null; feeMinor: number; feeLabel: string | null; pending: { id: string; amountLabel: string; createdAt: Date } | null; active: boolean };

export async function independentEligibility(db: PrismaClient, actor: Actor): Promise<IndependentEligibility> {
  const settings = await getSetting(db, "independentAccess");
  const feeLabel = settings.feeMinor > 0 ? formatMoney(settings.feeMinor, settings.currency) : null;
  const none = (reason: string | null): IndependentEligibility => ({ eligible: false, reason, feeMinor: settings.feeMinor, feeLabel, pending: null, active: false });
  if (actor.role !== "AGENT") return none("Only talent accounts can apply as independent freelancers.");
  if (!settings.enabled) return none("Independent reapplication is not open at the moment.");
  const u = await independentRepository.userBasics(db, actor.userId);
  if (!u) throw new NotFoundError();
  const current = u.agentProfiles.find((p) => !p.archivedAt) ?? null;
  if (current && current.status !== "FORMER_AGENCY_AGENT") return none(current.talentType === "INDEPENDENT_FREELANCER" ? "You already have an independent profile." : "Your current profile is active; independent reapplication is for former agency agents.");
  if (u.platformIdentity) {
    const open = await membershipRepository.openForIdentity(db, u.platformIdentity.id);
    if (open) return none("You still belong to an agency. Leaving goes through your agency and Hirewise first.");
  }
  const pending = await independentRepository.openForUser(db, actor.userId);
  if (pending) return { eligible: false, reason: "Your independent access is waiting for Hirewise to record the fee.", feeMinor: settings.feeMinor, feeLabel, pending: { id: pending.id, amountLabel: formatMoney(pending.amountMinor, pending.currency), createdAt: pending.createdAt }, active: false };
  return { eligible: true, reason: null, feeMinor: settings.feeMinor, feeLabel, pending: null, active: false };
}

/** Archives the former profile and creates the fresh independent one; links it to the access record. */
async function activateTx(tx: Db, actor: Actor, access: { id: string; userId: string; platformIdentityId: string | null; fromProfileId: string | null }): Promise<string> {
  const u = await independentRepository.userBasics(tx, access.userId);
  if (!u) throw new NotFoundError();
  const current = u.agentProfiles.find((p) => !p.archivedAt) ?? null;
  if (current) {
    await independentRepository.archive(tx, current.id);
    await audit(tx, { actor, action: "PROFILE_ARCHIVED", entityType: "AgentProfile", entityId: current.id, newValue: { reason: "Independent reapplication; a fresh profile starts" } });
  }
  const from = current?.id ?? access.fromProfileId ?? (await independentRepository.latestProfile(tx, access.userId))?.id;
  if (!from) throw new NotFoundError("No previous profile to start from");
  const fresh = await independentRepository.createFreshIndependent(tx, from, access.platformIdentityId ?? u.platformIdentity?.id ?? null, access.userId);
  await independentRepository.update(tx, access.id, { status: "ACTIVE", profileId: fresh.id });
  await audit(tx, { actor, action: "PROFILE_FRESH_CREATED", entityType: "AgentProfile", entityId: fresh.id, newValue: { fromProfileId: from, talentType: "INDEPENDENT_FREELANCER", accessId: access.id } });
  await publishEvent(tx, "INDEPENDENT_ACTIVATED", { accessId: access.id, userId: access.userId, email: u.email, profileId: fresh.id });
  return fresh.id;
}

export const independentApplySchema = z.object({ termsAccepted: z.boolean().default(false) });

/** The former agent applies: terms re-accepted in context, fee recorded by Hirewise when configured, fresh profile. */
export async function applyIndependent(db: PrismaClient, actor: Actor, raw: z.input<typeof independentApplySchema>, meta: RequestMeta): Promise<{ status: "ACTIVE" | "PENDING_PAYMENT"; profileId: string | null }> {
  const input = independentApplySchema.parse(raw);
  const e = await independentEligibility(db, actor);
  if (!e.eligible) throw new ForbiddenError(e.reason ?? "You cannot apply right now.");
  requireTermsAccepted(input.termsAccepted);
  const settings = await getSetting(db, "independentAccess");
  const u = await independentRepository.userBasics(db, actor.userId);
  if (!u) throw new NotFoundError();
  return db.$transaction(async (tx) => {
    await acceptTermsTx(tx, { userId: actor.userId, role: actor.role, agencyId: null, context: "INDEPENDENT_REAPPLICATION", meta, actor });
    const access = await independentRepository.create(tx, { userId: actor.userId, platformIdentityId: u.platformIdentity?.id ?? null, status: settings.feeMinor > 0 ? "PENDING_PAYMENT" : "ACTIVE", amountMinor: settings.feeMinor, currency: settings.currency, fromProfileId: u.agentProfiles.find((p) => !p.archivedAt)?.id ?? u.agentProfiles[0]?.id ?? null, note: null });
    await audit(tx, { actor, action: "INDEPENDENT_APPLIED", entityType: "IndependentAccess", entityId: access.id, newValue: { feeMinor: settings.feeMinor, status: access.status }, ipAddress: meta.ipAddress ?? undefined });
    await publishEvent(tx, "INDEPENDENT_APPLIED", { accessId: access.id, userId: actor.userId, email: u.email, feeMinor: settings.feeMinor, currency: settings.currency, pendingPayment: settings.feeMinor > 0 });
    if (settings.feeMinor > 0) return { status: "PENDING_PAYMENT" as const, profileId: null };
    const profileId = await activateTx(tx, actor, access);
    return { status: "ACTIVE" as const, profileId };
  });
}

export const independentOutcomeSchema = z.object({
  outcome: z.enum(["PAID", "WAIVED", "CANCELLED"]),
  reference: z.string().trim().max(120).optional().or(z.literal("")),
  note: z.string().trim().max(500).optional().or(z.literal("")),
});

/** Hirewise records the fee (or waives or cancels). Paid and waived activate the access and create the profile. */
export async function recordIndependentAccess(db: PrismaClient, actor: Actor, id: string, raw: z.input<typeof independentOutcomeSchema>) {
  authorize(actor, "agency.seats.manage");
  const input = independentOutcomeSchema.parse(raw);
  const access = await independentRepository.find(db, id);
  if (!access) throw new NotFoundError();
  if (access.status !== "PENDING_PAYMENT") throw new ForbiddenError("This access was already recorded.");
  if (input.outcome === "PAID" && !input.reference) throw Object.assign(new Error("Enter the payment reference."), { name: "RegistrationError", field: "reference" });
  return db.$transaction(async (tx) => {
    if (input.outcome === "CANCELLED") {
      await independentRepository.update(tx, id, { status: "CANCELLED", recordedById: actor.userId, note: input.note || null });
      await audit(tx, { actor, action: "INDEPENDENT_ACCESS_RECORDED", entityType: "IndependentAccess", entityId: id, newValue: { status: "CANCELLED" }, reason: input.note || undefined });
      return { status: "CANCELLED" as const, profileId: null };
    }
    await independentRepository.update(tx, id, { paymentReference: input.reference || null, paidAt: input.outcome === "PAID" ? new Date() : null, recordedById: actor.userId, note: input.note || null });
    await audit(tx, { actor, action: "INDEPENDENT_ACCESS_RECORDED", entityType: "IndependentAccess", entityId: id, newValue: { status: input.outcome, reference: input.reference || null }, reason: input.note || undefined });
    const profileId = await activateTx(tx, actor, access);
    return { status: "ACTIVE" as const, profileId };
  });
}

export async function listIndependentAccess(db: PrismaClient, actor: Actor, status?: "PENDING_PAYMENT" | "ACTIVE" | "CANCELLED") {
  authorize(actor, "agency.read");
  const [rows, counts] = await Promise.all([independentRepository.list(db, status), independentRepository.counts(db)]);
  const users = await Promise.all(rows.map((r) => independentRepository.userBasics(db, r.userId)));
  return { rows: rows.map((r, i) => ({ id: r.id, userId: r.userId, email: users[i]?.email ?? "", status: r.status, amountMinor: r.amountMinor, currency: r.currency, amountLabel: formatMoney(r.amountMinor, r.currency), paymentReference: r.paymentReference, paidAt: r.paidAt, profileId: r.profileId, note: r.note, createdAt: r.createdAt })), counts };
}
