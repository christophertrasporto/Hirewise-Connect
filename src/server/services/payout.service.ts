import { z } from "zod";
import type { PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorize, NotFoundError } from "@/server/policies/authorize";
import { referralRepository } from "@/server/repositories/referral.repository";
import { audit } from "@/server/audit/audit";
import { publishEvent } from "@/server/events/outbox";
import { encryptSecret, decryptSecret } from "@/server/auth/crypto";
import { getSetting } from "./setting.service";
import { balanceFor } from "./commission.service";
import { assertCanRefer } from "./referral.service";
import { maskAccount, toPayoutDetailsView, toPayoutMemberView } from "@/server/views/referral.views";

/** Referral payouts: the member's payout details and requests, and the staff queue (approve, pay with a reference, reject). */

export const payoutDetailsSchema = z
  .object({
    method: z.enum(["GCASH", "BANK_TRANSFER"]),
    accountName: z.string().trim().min(2, "Enter the name on the account.").max(120),
    accountNumber: z.string().trim().min(4, "Enter the account or mobile number.").max(40).regex(/^[0-9A-Za-z \-+]+$/, "Use letters, digits, spaces, and dashes only."),
    bankName: z.string().trim().max(120).optional().or(z.literal("")),
  })
  .superRefine((v, ctx) => {
    if (v.method === "BANK_TRANSFER" && !v.bankName) ctx.addIssue({ code: "custom", path: ["bankName"], message: "Enter the bank name." });
  });

export async function savePayoutDetails(db: PrismaClient, actor: Actor, raw: z.input<typeof payoutDetailsSchema>) {
  assertCanRefer(actor);
  const input = payoutDetailsSchema.parse(raw);
  await db.$transaction(async (tx) => {
    await referralRepository.upsertPayoutDetails(tx, actor.userId, { method: input.method, accountName: input.accountName, accountNumberEnc: encryptSecret(input.accountNumber), bankName: input.method === "BANK_TRANSFER" ? input.bankName || null : null });
    // The account number is never written to the audit log.
    await audit(tx, { actor, action: "PAYOUT_DETAILS_SET", entityType: "User", entityId: actor.userId, newValue: { method: input.method } });
  });
}

export async function myPayoutDetails(db: PrismaClient, actor: Actor) {
  assertCanRefer(actor);
  const d = await referralRepository.findPayoutDetails(db, actor.userId);
  return toPayoutDetailsView(d, d ? maskAccount(decryptSecret(d.accountNumberEnc)) : null);
}

export async function myPayouts(db: PrismaClient, actor: Actor) {
  assertCanRefer(actor);
  return (await referralRepository.listPayoutsFor(db, actor.userId)).map(toPayoutMemberView);
}

/** Takes every payable commission and unsettled adjustment into one payout. Refuses below the minimum or while another payout is open. */
export async function requestPayout(db: PrismaClient, actor: Actor) {
  assertCanRefer(actor);
  const settings = await getSetting(db, "referrals");
  return db.$transaction(async (tx) => {
    const details = await referralRepository.findPayoutDetails(tx, actor.userId);
    if (!details) throw new Error("Add your payout details first.");
    const open = (await referralRepository.listPayoutsFor(tx, actor.userId)).find((p) => p.status === "REQUESTED" || p.status === "APPROVED");
    if (open) throw new Error("You already have a payout in progress.");
    const commissions = await referralRepository.payableUnassigned(tx, actor.userId, settings.payoutCurrency);
    const adjustments = await referralRepository.unsettledAdjustments(tx, actor.userId, settings.payoutCurrency);
    const total = commissions.reduce((n, c) => n + c.commissionAmount, 0) + adjustments.reduce((n, a) => n + a.amount, 0);
    if (total <= 0 || total < settings.minimumPayoutMinor) throw new Error(`The minimum payout is ${(settings.minimumPayoutMinor / 100).toFixed(2)} ${settings.payoutCurrency}. Your payable balance is ${(Math.max(total, 0) / 100).toFixed(2)}.`);
    const label = `${details.method === "GCASH" ? "GCash" : details.bankName ?? "Bank"} ${maskAccount(decryptSecret(details.accountNumberEnc))}`;
    const payout = await referralRepository.createPayout(tx, { referrerId: actor.userId, amount: total, currency: settings.payoutCurrency, method: details.method, accountLabel: label });
    // A concurrent request or a refund could have changed the set; claiming by id and checking the count rolls the whole request back.
    const claimed = await referralRepository.claimCommissions(tx, commissions.map((c) => c.id), payout.id);
    const claimedAdj = await referralRepository.claimAdjustments(tx, adjustments.map((a) => a.id), payout.id);
    if (claimed !== commissions.length || claimedAdj !== adjustments.length) throw new Error("Your balance changed while the request was being made. Try again.");
    await audit(tx, { actor, action: "PAYOUT_REQUESTED", entityType: "Payout", entityId: payout.id, newValue: { amount: total, currency: settings.payoutCurrency, commissions: commissions.length, adjustments: adjustments.length } });
    await publishEvent(tx, "PAYOUT_REQUESTED", { payoutId: payout.id, referrerUserId: actor.userId, amount: total, currency: settings.payoutCurrency });
    return toPayoutMemberView(payout);
  });
}

// ---------------------------------------------------------------------------
// Staff queue (payout.manage)
// ---------------------------------------------------------------------------

export async function listPayoutQueue(db: PrismaClient, actor: Actor, status?: "REQUESTED" | "APPROVED" | "PAID" | "REJECTED") {
  authorize(actor, "payout.manage");
  const rows = await referralRepository.listPayouts(db, status);
  const open = rows.filter((p) => p.status === "REQUESTED" || p.status === "APPROVED");
  // Staff need the full account to send the money, for open payouts only.
  const details = new Map<string, { method: string; accountName: string; accountNumber: string; bankName: string | null }>();
  for (const p of open) {
    const d = await referralRepository.findPayoutDetails(db, p.referrerId);
    if (d) details.set(p.referrerId, { method: d.method, accountName: d.accountName, accountNumber: decryptSecret(d.accountNumberEnc), bankName: d.bankName });
  }
  return rows.map((p) => ({ id: p.id, referrer: p.referrer.email, referrerId: p.referrerId, amount: p.amount, currency: p.currency, method: p.method, accountLabel: p.accountLabel, status: p.status, reference: p.reference, rejectReason: p.rejectReason, requestedAt: p.requestedAt, decidedAt: p.decidedAt, paidAt: p.paidAt, account: details.get(p.referrerId) ?? null }));
}

async function loadPayout(tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0], id: string) {
  const p = await referralRepository.findPayout(tx, id);
  if (!p) throw new NotFoundError();
  return p;
}

export async function approvePayout(db: PrismaClient, actor: Actor, id: string) {
  authorize(actor, "payout.manage");
  await db.$transaction(async (tx) => {
    const p = await loadPayout(tx, id);
    if (p.status !== "REQUESTED") throw new Error("Only a requested payout can be approved.");
    await referralRepository.setPayout(tx, id, { status: "APPROVED", decidedById: actor.userId, decidedAt: new Date() });
    await audit(tx, { actor, action: "PAYOUT_APPROVED", entityType: "Payout", entityId: id, newValue: { amount: p.amount, currency: p.currency } });
    await publishEvent(tx, "PAYOUT_DECIDED", { payoutId: id, referrerUserId: p.referrerId, outcome: "APPROVED", amount: p.amount, currency: p.currency, reference: null, reason: null });
  });
}

export const markPaidSchema = z.object({ reference: z.string().trim().min(3, "Enter the transfer reference number.").max(120) });

export async function markPayoutPaid(db: PrismaClient, actor: Actor, id: string, raw: z.input<typeof markPaidSchema>) {
  authorize(actor, "payout.manage");
  const { reference } = markPaidSchema.parse(raw);
  await db.$transaction(async (tx) => {
    const p = await loadPayout(tx, id);
    if (p.status !== "APPROVED") throw new Error("Approve the payout before marking it paid.");
    const now = new Date();
    await referralRepository.setPayout(tx, id, { status: "PAID", reference, paidAt: now, decidedById: actor.userId });
    await referralRepository.markPayoutCommissionsPaid(tx, id, now);
    await audit(tx, { actor, action: "PAYOUT_PAID", entityType: "Payout", entityId: id, newValue: { amount: p.amount, currency: p.currency, reference } });
    await publishEvent(tx, "PAYOUT_DECIDED", { payoutId: id, referrerUserId: p.referrerId, outcome: "PAID", amount: p.amount, currency: p.currency, reference, reason: null });
  });
}

export const rejectSchema = z.object({ reason: z.string().trim().min(3, "Give the member a reason.").max(500) });

export async function rejectPayout(db: PrismaClient, actor: Actor, id: string, raw: z.input<typeof rejectSchema>) {
  authorize(actor, "payout.manage");
  const { reason } = rejectSchema.parse(raw);
  await db.$transaction(async (tx) => {
    const p = await loadPayout(tx, id);
    if (p.status !== "REQUESTED" && p.status !== "APPROVED") throw new Error("This payout is already closed.");
    await referralRepository.releasePayoutClaims(tx, id);
    await referralRepository.setPayout(tx, id, { status: "REJECTED", rejectReason: reason, decidedById: actor.userId, decidedAt: new Date() });
    await audit(tx, { actor, action: "PAYOUT_REJECTED", entityType: "Payout", entityId: id, newValue: { amount: p.amount }, reason });
    await publishEvent(tx, "PAYOUT_DECIDED", { payoutId: id, referrerUserId: p.referrerId, outcome: "REJECTED", amount: p.amount, currency: p.currency, reference: null, reason });
  });
}

/** The balance the staff queue shows next to a payout request. */
export async function referrerBalance(db: PrismaClient, actor: Actor, userId: string) {
  authorize(actor, "payout.manage");
  const s = await getSetting(db, "referrals");
  return balanceFor(db, userId, s.payoutCurrency);
}
