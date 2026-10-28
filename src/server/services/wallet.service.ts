import { z } from "zod";
import type { Db, PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { systemActor } from "@/server/auth/actor";
import { authorize, NotFoundError } from "@/server/policies/authorize";
import { audit } from "@/server/audit/audit";
import { publishEvent } from "@/server/events/outbox";
import { encryptSecret, decryptSecret } from "@/server/auth/crypto";
import { referralRepository } from "@/server/repositories/referral.repository";
import { settingRepository } from "@/server/repositories/setting.repository";
import { walletRepository } from "@/server/repositories/wallet.repository";
import { MAX_COACH_SHARE_BPS, availableAtFor, buyerLabel, parseFeeCsv, proportionalShare, splitSale } from "@/lib/coach-wallet";
import { formatMoney } from "@/server/views/seat.views";
import { toCoachSaleView, toWithdrawalView } from "@/server/views/wallet.views";
import { getSetting, SETTING_SCHEMAS } from "./setting.service";

/**
 * Coach Wallet. A coach earns a share of the net of every sale of their course: net = what the buyer paid minus the
 * gateway's actual fee. Earnings are created only inside the settlement of a confirmed payment, exactly once per sale,
 * with the split rate locked at that moment. A coach's balance is always computed from the append-only ledger.
 *
 * Available to withdraw = ledger total minus what is still on hold. That one rule makes a negative balance after a
 * post-withdrawal refund repay itself from later earnings with no special handling.
 */

export const WALLET_CURRENCY = "PHP";

export class WalletError extends Error {
  override name = "WalletError";
  constructor(message: string, readonly field?: string) {
    super(message);
  }
}

const noteSchema = z.string().trim().min(3, "Add a note explaining why.").max(500);

// ---------------------------------------------------------------------------
// Creating an earning (called only from payment settlement)
// ---------------------------------------------------------------------------

/** The coach's locked split rate: a special deal if there is one, else the global rate; never above the cap. */
async function rateFor(db: Db, coachUserId: string): Promise<number> {
  const [settings, override] = await Promise.all([getSetting(db, "coachWallet"), walletRepository.findOverride(db, coachUserId)]);
  return Math.min(override?.shareBps ?? settings.coachShareBps, MAX_COACH_SHARE_BPS);
}

/**
 * Creates the earning for a freshly settled enrolment payment. Idempotent (one earning per enrolment). A sale earns
 * nothing when nothing was paid (free, waived, a 100% code), when it was not paid in PHP, or when the course owner is
 * not a Coach, in which case the whole net simply stays with the platform.
 *
 * A gateway sale starts PENDING_FEE until the real fee is reported; a bank or GCash payment recorded by staff has no
 * gateway fee (zero, or the amount staff enter) and goes straight on hold.
 */
export async function recordEarningForPaymentTx(tx: Db, p: { enrollmentId: string; channel: "STAFF" | "MAYA"; gatewayFeeMinor?: number | null; paidAt: Date; now?: Date }) {
  if (await walletRepository.findByEnrollment(tx, p.enrollmentId)) return null;
  const e = await walletRepository.enrollmentForEarning(tx, p.enrollmentId);
  if (!e || !e.paidCents || e.paidCents <= 0 || e.currency !== WALLET_CURRENCY) return null;
  const coach = await walletRepository.coachBasics(tx, e.course.ownerCoachUserId);
  if (!coach || coach.deletedAt || coach.role.key !== "COACH") return null;

  const now = p.now ?? new Date();
  const settings = await getSetting(tx, "coachWallet");
  const rateBps = await rateFor(tx, coach.id);
  const availableAt = availableAtFor(p.paidAt, settings.refundWindowDays, settings.holdBufferDays);
  const affiliate = (await referralRepository.findBySource(tx, "ENROLLMENT", e.id))?.commissionAmount ?? 0;
  const base = { coachUserId: coach.id, enrollmentId: e.id, courseId: e.courseId, courseTitle: e.course.title, buyerUserId: e.agentProfile.userId, buyerLabel: buyerLabel(e.agentProfile.displayName), saleAmount: e.paidCents, coachRateBps: rateBps, affiliateAmount: affiliate, currency: e.currency, channel: p.channel, paidAt: p.paidAt, availableAt };

  if (p.channel === "MAYA" && p.gatewayFeeMinor == null) {
    const row = await walletRepository.createEarning(tx, { ...base, status: "PENDING_FEE" });
    await audit(tx, { actor: systemActor(), action: "WALLET_EARNING_CREATED", entityType: "CoachEarning", entityId: row.id, newValue: { coachUserId: coach.id, enrollmentId: e.id, saleAmount: e.paidCents, status: "PENDING_FEE", coachRateBps: rateBps } });
    await publishEvent(tx, "WALLET_EARNING_CREATED", { earningId: row.id, coachUserId: coach.id, courseTitle: e.course.title, status: "PENDING_FEE" });
    return row;
  }

  const fee = p.gatewayFeeMinor ?? 0;
  const split = splitSale({ saleMinor: e.paidCents, feeMinor: fee, coachBps: rateBps, affiliateMinor: affiliate });
  const status = availableAt <= now ? "AVAILABLE" : "ON_HOLD";
  const row = await walletRepository.createEarning(tx, { ...base, gatewayFee: fee, netAmount: split.netMinor, coachAmount: split.coachMinor, platformAmount: split.platformMinor, feeSource: p.channel === "STAFF" ? (fee > 0 ? "STAFF_ENTRY" : "OFFLINE") : "GATEWAY_API", status });
  await walletRepository.addEntry(tx, { coachUserId: coach.id, type: "EARNING", amount: split.coachMinor, currency: e.currency, earningId: row.id, note: `Sale of ${e.course.title}` });
  await audit(tx, { actor: systemActor(), action: "WALLET_EARNING_CREATED", entityType: "CoachEarning", entityId: row.id, newValue: { coachUserId: coach.id, enrollmentId: e.id, saleAmount: e.paidCents, fee, net: split.netMinor, coachAmount: split.coachMinor, platformAmount: split.platformMinor, affiliateAmount: affiliate, platformKeepsMinor: split.platformKeepsMinor, status, coachRateBps: rateBps } });
  await publishEvent(tx, "WALLET_EARNING_CREATED", { earningId: row.id, coachUserId: coach.id, courseTitle: e.course.title, status: "ON_HOLD" });
  return row;
}

// ---------------------------------------------------------------------------
// The real gateway fee arrives (staff entry or a settlement report)
// ---------------------------------------------------------------------------

type FeeSource = "STAFF_ENTRY" | "SETTLEMENT_IMPORT" | "GATEWAY_API";

async function setFeeTx(tx: Db, actor: Actor, earningId: string, feeMinor: number, source: FeeSource, now = new Date()) {
  const e = await walletRepository.findEarning(tx, earningId);
  if (!e) throw new NotFoundError();
  await walletRepository.lockCoach(tx, e.coachUserId);
  const fresh = await walletRepository.findEarning(tx, earningId);
  if (!fresh) throw new NotFoundError();
  if (fresh.status !== "PENDING_FEE") throw new WalletError("The gateway fee for this sale is already recorded.");
  if (!Number.isInteger(feeMinor) || feeMinor < 0 || feeMinor > fresh.saleAmount) throw new WalletError(`The fee must be between 0 and the sale amount (${formatMoney(fresh.saleAmount, fresh.currency)}).`, "fee");
  const split = splitSale({ saleMinor: fresh.saleAmount, feeMinor, coachBps: fresh.coachRateBps, affiliateMinor: fresh.affiliateAmount });
  const status = fresh.availableAt <= now ? "AVAILABLE" : "ON_HOLD";
  // A refund recorded while the fee was unknown was held back from the ledger; apply its share now.
  const refunded = fresh.refundedSaleMinor;
  const reversed = refunded > 0 ? proportionalShare(split.coachMinor, refunded, fresh.saleAmount) : 0;
  const full = refunded >= fresh.saleAmount;
  const row = await walletRepository.updateEarning(tx, fresh.id, { gatewayFee: feeMinor, netAmount: split.netMinor, coachAmount: split.coachMinor, platformAmount: split.platformMinor, feeSource: source, status: full ? "REVERSED" : status, coachReversedMinor: full ? split.coachMinor : reversed, feeAbsorbedMinor: refunded > 0 ? proportionalShare(feeMinor, refunded, fresh.saleAmount) : 0 });
  if (!full) {
    await walletRepository.addEntry(tx, { coachUserId: fresh.coachUserId, type: "EARNING", amount: split.coachMinor, currency: fresh.currency, earningId: fresh.id, note: `Sale of ${fresh.courseTitle}`, createdById: actor.userId === "system" ? null : actor.userId });
    if (reversed > 0) await walletRepository.addEntry(tx, { coachUserId: fresh.coachUserId, type: "REVERSAL", amount: -reversed, currency: fresh.currency, earningId: fresh.id, note: "Partial refund recorded before the fee was known" });
  }
  await audit(tx, { actor, action: "WALLET_FEE_SET", entityType: "CoachEarning", entityId: fresh.id, newValue: { feeMinor, source, net: split.netMinor, coachAmount: split.coachMinor, platformAmount: split.platformMinor, status: row.status } });
  return row;
}

/** Staff records the actual fee the gateway charged for one sale. */
export async function setGatewayFee(db: PrismaClient, actor: Actor, earningId: string, feeMinor: number) {
  authorize(actor, "wallet.manage");
  return db.$transaction((tx) => setFeeTx(tx, actor, earningId, feeMinor, "STAFF_ENTRY"));
}

export type FeeImportResult = { applied: number; alreadyRecorded: number; notFound: Array<{ line: number; reference: string }>; invalid: Array<{ line: number; reference: string; error: string }>; headerError?: string };

/**
 * Applies the fees in a settlement report (CSV). Each row names a Maya payment id, our request reference number, or
 * the enrolment id, and the fee Maya charged. Only sales still waiting for a fee are changed; rows are independent, so
 * one bad row never blocks the rest. Nothing is estimated: a sale with no row simply stays PENDING_FEE.
 */
export async function importSettlementFees(db: PrismaClient, actor: Actor, csv: string): Promise<FeeImportResult> {
  authorize(actor, "wallet.manage");
  const parsed = parseFeeCsv(csv);
  const result: FeeImportResult = { applied: 0, alreadyRecorded: 0, notFound: [], invalid: [], headerError: parsed.error };
  for (const row of parsed.rows) {
    if (row.feeMinor === null) {
      result.invalid.push({ line: row.line, reference: row.reference, error: row.error ?? "Invalid row." });
      continue;
    }
    const online = await walletRepository.findOnlinePaymentByReference(db, row.reference);
    const enrollmentId = online?.enrollmentId ?? row.reference;
    const earning = await walletRepository.findByEnrollment(db, enrollmentId);
    if (!earning) {
      result.notFound.push({ line: row.line, reference: row.reference });
      continue;
    }
    if (earning.status !== "PENDING_FEE") {
      result.alreadyRecorded++;
      continue;
    }
    try {
      await db.$transaction((tx) => setFeeTx(tx, actor, earning.id, row.feeMinor!, "SETTLEMENT_IMPORT"));
      result.applied++;
    } catch (err) {
      result.invalid.push({ line: row.line, reference: row.reference, error: err instanceof Error ? err.message : "Could not apply." });
    }
  }
  return result;
}

export async function listPendingFees(db: PrismaClient, actor: Actor) {
  authorize(actor, "wallet.manage");
  const rows = await walletRepository.listPendingFee(db);
  return rows.map((e) => ({ id: e.id, paidAt: e.paidAt, coachEmail: e.coach.email, courseTitle: e.courseTitle, buyer: e.buyerLabel, saleAmount: e.saleAmount, currency: e.currency, saleLabel: formatMoney(e.saleAmount, e.currency), enrollmentId: e.enrollmentId }));
}

// ---------------------------------------------------------------------------
// Hold to available
// ---------------------------------------------------------------------------

/** Maintenance: earnings whose hold has ended become available. Idempotent; the pass runs every few minutes. */
export async function releaseDueEarnings(db: Db, now = new Date()): Promise<number> {
  return walletRepository.releaseDue(db, now);
}

// ---------------------------------------------------------------------------
// Refunds and chargebacks
// ---------------------------------------------------------------------------

/**
 * A refund or chargeback on a paid enrolment, full (omit refundMinor: whatever is left) or partial. The coach's earning
 * is reversed in proportion: before withdrawal it simply leaves the wallet; after withdrawal a negative ledger entry
 * can take the balance below zero, and later earnings repay it. The gateway fee is not returned, so the platform absorbs
 * its share of the fee and the coach is reversed in full on the refunded part; the absorbed amount is recorded.
 */
export async function reverseEarningForRefundTx(tx: Db, actor: Actor, p: { enrollmentId: string; refundMinor?: number | null; kind: "REFUND" | "CHARGEBACK"; reason: string }) {
  const e = await walletRepository.findByEnrollment(tx, p.enrollmentId);
  if (!e || e.status === "REVERSED") return null;
  await walletRepository.lockCoach(tx, e.coachUserId);
  const row = (await walletRepository.findEarning(tx, e.id))!;
  if (row.status === "REVERSED") return null;
  const remaining = row.saleAmount - row.refundedSaleMinor;
  const delta = p.refundMinor ?? remaining;
  if (!Number.isInteger(delta) || delta <= 0 || delta > remaining) throw new WalletError(`The refund must be between 0.01 and ${formatMoney(remaining, row.currency)}.`, "amount");
  const newRefunded = row.refundedSaleMinor + delta;
  const full = newRefunded >= row.saleAmount;

  if (row.status === "PENDING_FEE") {
    if (!full) throw new WalletError("Enter the gateway fee for this sale before recording a partial refund.", "amount");
    await walletRepository.updateEarning(tx, row.id, { status: "REVERSED", refundedSaleMinor: newRefunded, reversedAt: new Date() });
    await audit(tx, { actor, action: "WALLET_EARNING_REVERSED", entityType: "CoachEarning", entityId: row.id, newValue: { kind: p.kind, afterWithdrawal: false, coachReversedMinor: 0 }, reason: p.reason });
    await publishEvent(tx, "WALLET_EARNING_REVERSED", { earningId: row.id, coachUserId: row.coachUserId, courseTitle: row.courseTitle, afterWithdrawal: false });
    return { coachReversedMinor: 0, feeAbsorbedMinor: 0, afterWithdrawal: false };
  }

  const coachAmount = row.coachAmount ?? 0;
  const targetReversed = full ? coachAmount : proportionalShare(coachAmount, newRefunded, row.saleAmount);
  const coachDelta = Math.max(0, targetReversed - row.coachReversedMinor);
  const fee = row.gatewayFee ?? 0;
  const feeTarget = full ? fee : proportionalShare(fee, newRefunded, row.saleAmount);
  const feeDelta = Math.max(0, feeTarget - row.feeAbsorbedMinor);
  const afterWithdrawal = row.status === "WITHDRAWN";
  if (coachDelta > 0) {
    await walletRepository.addEntry(tx, { coachUserId: row.coachUserId, type: afterWithdrawal ? "REFUND_AFTER_WITHDRAWAL" : "REVERSAL", amount: -coachDelta, currency: row.currency, earningId: row.id, note: `${p.kind === "REFUND" ? "Refund" : "Chargeback"}${full ? "" : " (partial)"}: ${p.reason}`, createdById: actor.userId === "system" ? null : actor.userId });
  }
  await walletRepository.updateEarning(tx, row.id, { refundedSaleMinor: newRefunded, coachReversedMinor: row.coachReversedMinor + coachDelta, feeAbsorbedMinor: row.feeAbsorbedMinor + feeDelta, ...(full ? { status: "REVERSED", reversedAt: new Date() } : {}) });
  await audit(tx, { actor, action: "WALLET_EARNING_REVERSED", entityType: "CoachEarning", entityId: row.id, previousValue: { status: row.status }, newValue: { kind: p.kind, full, refundedSaleMinor: newRefunded, coachReversedMinor: coachDelta, feeAbsorbedMinor: feeDelta, afterWithdrawal }, reason: p.reason });
  await publishEvent(tx, "WALLET_EARNING_REVERSED", { earningId: row.id, coachUserId: row.coachUserId, courseTitle: row.courseTitle, afterWithdrawal });
  return { coachReversedMinor: coachDelta, feeAbsorbedMinor: feeDelta, afterWithdrawal };
}

// ---------------------------------------------------------------------------
// Balances and the coach's own view (coach.wallet)
// ---------------------------------------------------------------------------

export async function balanceFor(db: Db, coachUserId: string, currency = WALLET_CURRENCY) {
  const [total, onHold, withdrawn, pending, next] = await Promise.all([
    walletRepository.ledgerTotal(db, coachUserId, currency),
    walletRepository.onHoldTotal(db, coachUserId, currency),
    walletRepository.paidTotal(db, coachUserId, currency),
    walletRepository.pendingFeeSummary(db, coachUserId, currency),
    walletRepository.nextAvailableAt(db, coachUserId),
  ]);
  const available = total - onHold;
  return { currency, total, onHold, available, withdrawable: Math.max(0, available), withdrawn, pendingFeeCount: pending.count, pendingFeeSaleMinor: pending.saleMinor, nextAvailableAt: next };
}

const dateRange = z.object({ courseId: z.string().optional(), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
export type WalletFilters = z.input<typeof dateRange>;

/** Calendar days in Manila time; `to` is inclusive. */
function range(f: WalletFilters) {
  const p = dateRange.parse(f);
  return { courseId: p.courseId || undefined, from: p.from ? new Date(`${p.from}T00:00:00.000+08:00`) : undefined, to: p.to ? new Date(new Date(`${p.to}T00:00:00.000+08:00`).getTime() + 86_400_000) : undefined };
}

/** The signed-in coach's wallet. The coach is always the actor: no id is ever taken from the request. */
export async function myWallet(db: PrismaClient, actor: Actor, filters: WalletFilters = {}) {
  authorize(actor, "coach.wallet");
  const [settings, balance, rows, withdrawals, details, courses] = await Promise.all([
    getSetting(db, "coachWallet"),
    balanceFor(db, actor.userId),
    walletRepository.listEarningsFor(db, actor.userId, range(filters)),
    walletRepository.listWithdrawalsFor(db, actor.userId),
    walletRepository.findPayoutDetails(db, actor.userId),
    walletRepository.listEarningsFor(db, actor.userId, {}, 1000),
  ]);
  const emails = new Map<string, string | null>();
  if (settings.showBuyerEmail) for (const r of rows) if (!emails.has(r.buyerUserId)) emails.set(r.buyerUserId, (await walletRepository.buyerBasics(db, r.buyerUserId))?.email ?? null);
  return {
    balance,
    minimumWithdrawalMinor: settings.minimumWithdrawalMinor,
    sales: rows.map((r) => toCoachSaleView(r, { buyerEmail: settings.showBuyerEmail ? (emails.get(r.buyerUserId) ?? null) : null })),
    courses: [...new Map(courses.map((c) => [c.courseId, c.courseTitle])).entries()].map(([id, title]) => ({ id, title })),
    withdrawals: withdrawals.map((w) => toWithdrawalView(w)),
    payoutDetails: details ? { method: details.method, accountName: details.accountName, accountMasked: maskAccount(decryptSecret(details.accountNumberEnc)), bankName: details.bankName } : null,
  };
}
export type MyWallet = Awaited<ReturnType<typeof myWallet>>;

export function maskAccount(n: string): string {
  const digits = n.replace(/\s+/g, "");
  return digits.length <= 4 ? "****" : `****${digits.slice(-4)}`;
}

const dec = (minor: number | null) => (minor === null ? "" : `${Math.trunc(minor / 100)}.${String(Math.abs(minor % 100)).padStart(2, "0")}`);
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** The coach's sales as a CSV (the same rows and filters as the table). */
export async function myWalletCsv(db: PrismaClient, actor: Actor, filters: WalletFilters = {}): Promise<string> {
  const w = await myWallet(db, actor, filters);
  const head = ["Date", "Buyer", "Course", "Sale price", "Gateway fee", "Net", "Your share", "Your earning", "Status", "Available on"];
  const lines = w.sales.map((s) => [s.paidAt.toISOString().slice(0, 10), s.buyer, s.courseTitle, dec(s.saleAmount), dec(s.gatewayFee), dec(s.netAmount), `${s.coachRatePercent}%`, dec(s.coachAmount), s.status, s.status === "PENDING_FEE" ? "" : s.availableAt.toISOString().slice(0, 10)].map(String).map(csvCell).join(","));
  return [head.join(","), ...lines].join("\n") + "\n";
}

// Payout account (shared with the referral program: one account per member)

export const walletPayoutSchema = z
  .object({
    method: z.enum(["GCASH", "MAYA", "BANK_TRANSFER"]),
    accountName: z.string().trim().min(2, "Enter the name on the account.").max(120),
    accountNumber: z.string().trim().min(4, "Enter the account or mobile number.").max(40).regex(/^[0-9A-Za-z \-+]+$/, "Use letters, digits, spaces, and dashes only."),
    bankName: z.string().trim().max(120).optional().or(z.literal("")),
  })
  .superRefine((v, ctx) => {
    if (v.method === "BANK_TRANSFER" && !v.bankName) ctx.addIssue({ code: "custom", path: ["bankName"], message: "Enter the bank name." });
  });

export async function saveMyPayoutDetails(db: PrismaClient, actor: Actor, raw: z.input<typeof walletPayoutSchema>) {
  authorize(actor, "coach.wallet");
  const input = walletPayoutSchema.parse(raw);
  await db.$transaction(async (tx) => {
    await walletRepository.upsertPayoutDetails(tx, actor.userId, { method: input.method, accountName: input.accountName, accountNumberEnc: encryptSecret(input.accountNumber), bankName: input.method === "BANK_TRANSFER" ? input.bankName || null : null });
    // The account number is never written to the audit log.
    await audit(tx, { actor, action: "WALLET_PAYOUT_DETAILS_SET", entityType: "User", entityId: actor.userId, newValue: { method: input.method } });
  });
}

// ---------------------------------------------------------------------------
// Withdrawals
// ---------------------------------------------------------------------------

const methodLabel = (m: string, bank: string | null) => (m === "GCASH" ? "GCash" : m === "MAYA" ? "Maya" : (bank ?? "Bank"));

/**
 * The coach withdraws their whole available balance. Refused below the minimum, with no payout details, or while another
 * request is open. The amount is taken out of the ledger the moment it is requested, so it cannot be requested twice.
 */
export async function requestWithdrawal(db: PrismaClient, actor: Actor) {
  authorize(actor, "coach.wallet");
  const settings = await getSetting(db, "coachWallet");
  return db.$transaction(async (tx) => {
    await walletRepository.lockCoach(tx, actor.userId);
    const details = await walletRepository.findPayoutDetails(tx, actor.userId);
    if (!details) throw new WalletError("Add your payout details first.");
    if (await walletRepository.openWithdrawalFor(tx, actor.userId)) throw new WalletError("You already have a withdrawal in progress.");
    const b = await balanceFor(tx, actor.userId);
    if (b.withdrawable <= 0 || b.withdrawable < settings.minimumWithdrawalMinor) {
      throw new WalletError(`The minimum withdrawal is ${formatMoney(settings.minimumWithdrawalMinor, WALLET_CURRENCY)}. Your available balance is ${formatMoney(Math.max(b.available, 0), WALLET_CURRENCY)}.`);
    }
    const w = await walletRepository.createWithdrawal(tx, { coachUserId: actor.userId, amount: b.withdrawable, currency: WALLET_CURRENCY, method: details.method, accountName: details.accountName, accountNumberEnc: details.accountNumberEnc, bankName: details.bankName, accountLabel: `${methodLabel(details.method, details.bankName)} ${maskAccount(decryptSecret(details.accountNumberEnc))}` });
    await walletRepository.addEntry(tx, { coachUserId: actor.userId, type: "WITHDRAWAL", amount: -w.amount, currency: WALLET_CURRENCY, withdrawalId: w.id, note: "Withdrawal requested", createdById: actor.userId });
    await audit(tx, { actor, action: "WALLET_WITHDRAWAL_REQUESTED", entityType: "CoachWithdrawal", entityId: w.id, newValue: { amount: w.amount, currency: w.currency, method: w.method } });
    await publishEvent(tx, "WALLET_WITHDRAWAL_REQUESTED", { withdrawalId: w.id, coachUserId: actor.userId, amount: w.amount, currency: w.currency });
    return toWithdrawalView(w);
  });
}

export const withdrawalDecisionSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("APPROVED") }),
  z.object({ outcome: z.literal("PAID"), reference: z.string().trim().min(3, "Enter the payment reference.").max(120) }),
  z.object({ outcome: z.literal("REJECTED"), reason: z.string().trim().min(3, "Say why it was declined.").max(500) }),
]);

export async function listWithdrawalQueue(db: PrismaClient, actor: Actor, statuses: Array<"REQUESTED" | "APPROVED" | "PAID" | "REJECTED"> = ["REQUESTED", "APPROVED"]) {
  authorize(actor, "wallet.manage");
  // Staff need the full account number to send the money; coaches only ever get the masked label.
  return (await walletRepository.listWithdrawals(db, statuses)).map((w) => ({ ...toWithdrawalView(w, { includeCoach: true }), account_details: { method: w.method, accountName: w.accountName, accountNumber: decryptSecret(w.accountNumberEnc), bankName: w.bankName } }));
}

/** Approve, mark paid with a reference, or reject with a reason. A rejected request returns its amount to the balance. */
export async function decideWithdrawal(db: PrismaClient, actor: Actor, id: string, raw: z.input<typeof withdrawalDecisionSchema>) {
  authorize(actor, "wallet.manage");
  const input = withdrawalDecisionSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const found = await walletRepository.findWithdrawal(tx, id);
    if (!found) throw new NotFoundError();
    await walletRepository.lockCoach(tx, found.coachUserId);
    const w = (await walletRepository.findWithdrawal(tx, id))!;
    const open = w.status === "REQUESTED" || w.status === "APPROVED";
    if (!open) throw new WalletError(`This withdrawal is already ${w.status.toLowerCase()}.`);
    if (input.outcome === "APPROVED" && w.status !== "REQUESTED") throw new WalletError("This withdrawal is already approved.");
    const now = new Date();
    let updated;
    if (input.outcome === "APPROVED") updated = await walletRepository.updateWithdrawal(tx, id, { status: "APPROVED", decidedById: actor.userId, decidedAt: now });
    else if (input.outcome === "PAID") {
      updated = await walletRepository.updateWithdrawal(tx, id, { status: "PAID", reference: input.reference, decidedById: actor.userId, decidedAt: now, paidAt: now });
      await walletRepository.markWithdrawnUpTo(tx, w.coachUserId, w.amount);
    } else {
      updated = await walletRepository.updateWithdrawal(tx, id, { status: "REJECTED", rejectionReason: input.reason, decidedById: actor.userId, decidedAt: now });
      await walletRepository.addEntry(tx, { coachUserId: w.coachUserId, type: "WITHDRAWAL_RELEASED", amount: w.amount, currency: w.currency, withdrawalId: w.id, note: `Withdrawal declined: ${input.reason}`, createdById: actor.userId });
    }
    await audit(tx, { actor, action: "WALLET_WITHDRAWAL_DECIDED", entityType: "CoachWithdrawal", entityId: id, previousValue: { status: w.status }, newValue: { status: updated.status, reference: input.outcome === "PAID" ? input.reference : null }, reason: input.outcome === "REJECTED" ? input.reason : undefined });
    await publishEvent(tx, "WALLET_WITHDRAWAL_DECIDED", { withdrawalId: id, coachUserId: w.coachUserId, outcome: input.outcome, amount: w.amount, currency: w.currency, reference: input.outcome === "PAID" ? input.reference : null, reason: input.outcome === "REJECTED" ? input.reason : null });
    return toWithdrawalView(updated, { includeCoach: true });
  });
}

// ---------------------------------------------------------------------------
// Admin: coaches, adjustments, special rates, settings, revenue report (wallet.manage)
// ---------------------------------------------------------------------------

export async function listCoachWallets(db: PrismaClient, actor: Actor) {
  authorize(actor, "wallet.manage");
  const [coaches, overrides, settings] = await Promise.all([walletRepository.coachUsers(db), walletRepository.listOverrides(db), getSetting(db, "coachWallet")]);
  const byCoach = new Map(overrides.map((o) => [o.coachUserId, o]));
  return Promise.all(
    coaches.map(async (c) => {
      const b = await balanceFor(db, c.id);
      const o = byCoach.get(c.id);
      return { id: c.id, email: c.email, balance: b, shareBps: o?.shareBps ?? settings.coachShareBps, hasOverride: !!o, overrideNote: o?.note ?? null };
    }),
  );
}

export async function coachWalletDetail(db: PrismaClient, actor: Actor, coachUserId: string) {
  authorize(actor, "wallet.manage");
  const coach = await walletRepository.coachBasics(db, coachUserId);
  if (!coach || coach.role.key !== "COACH") throw new NotFoundError();
  const [balance, ledger, earnings, withdrawals, override] = await Promise.all([balanceFor(db, coachUserId), walletRepository.listLedger(db, coachUserId), walletRepository.listEarningsFor(db, coachUserId), walletRepository.listWithdrawalsFor(db, coachUserId), walletRepository.findOverride(db, coachUserId)]);
  return {
    coach: { id: coach.id, email: coach.email },
    balance,
    ledger: ledger.map((l) => ({ id: l.id, createdAt: l.createdAt, type: l.type, amount: l.amount, label: formatMoney(l.amount, l.currency), note: l.note, createdById: l.createdById })),
    earnings: earnings.map((e) => ({ ...toCoachSaleView(e, { buyerEmail: null }), affiliateAmount: e.affiliateAmount, feeSource: e.feeSource, feeAbsorbedMinor: e.feeAbsorbedMinor })),
    withdrawals: withdrawals.map((w) => toWithdrawalView(w)),
    override: override ? { shareBps: override.shareBps, note: override.note } : null,
  };
}

export const adjustmentSchema = z.object({
  coachUserId: z.string().min(1),
  amountMinor: z.coerce.number().int().refine((n) => n !== 0, "Enter a non-zero amount."),
  note: noteSchema,
});

/** A signed manual change to a coach's balance. The required note goes in the ledger and the audit log. */
export async function adjustWallet(db: PrismaClient, actor: Actor, raw: z.input<typeof adjustmentSchema>) {
  authorize(actor, "wallet.manage");
  const input = adjustmentSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const coach = await walletRepository.coachBasics(tx, input.coachUserId);
    if (!coach || coach.role.key !== "COACH") throw new NotFoundError();
    await walletRepository.lockCoach(tx, coach.id);
    const entry = await walletRepository.addEntry(tx, { coachUserId: coach.id, type: "ADJUSTMENT", amount: input.amountMinor, currency: WALLET_CURRENCY, note: input.note, createdById: actor.userId });
    await audit(tx, { actor, action: "WALLET_ADJUSTED", entityType: "User", entityId: coach.id, newValue: { entryId: entry.id, amount: input.amountMinor, currency: WALLET_CURRENCY }, reason: input.note });
    return { id: entry.id };
  });
}

export const overrideSchema = z.object({
  coachUserId: z.string().min(1),
  percent: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Enter a percentage like 70 or 62.5."),
  note: noteSchema,
});

/** A special deal for one coach. It applies to new sales only; earnings already made keep the rate they were made at. */
export async function setCoachShareOverride(db: PrismaClient, actor: Actor, raw: z.input<typeof overrideSchema>) {
  authorize(actor, "wallet.manage");
  const input = overrideSchema.parse(raw);
  const shareBps = Math.round(Number(input.percent) * 100);
  if (shareBps < 0 || shareBps > MAX_COACH_SHARE_BPS) throw new WalletError(`A special rate can be from 0% to ${MAX_COACH_SHARE_BPS / 100}%, so the platform share can always cover the affiliate commission.`, "percent");
  await db.$transaction(async (tx) => {
    const coach = await walletRepository.coachBasics(tx, input.coachUserId);
    if (!coach || coach.role.key !== "COACH") throw new NotFoundError();
    await walletRepository.upsertOverride(tx, coach.id, { shareBps, note: input.note, createdById: actor.userId });
    await audit(tx, { actor, action: "WALLET_OVERRIDE_SET", entityType: "User", entityId: coach.id, newValue: { shareBps }, reason: input.note });
  });
}

export async function clearCoachShareOverride(db: PrismaClient, actor: Actor, coachUserId: string, note: string) {
  authorize(actor, "wallet.manage");
  const reason = noteSchema.parse(note);
  await db.$transaction(async (tx) => {
    await walletRepository.deleteOverride(tx, coachUserId);
    await audit(tx, { actor, action: "WALLET_OVERRIDE_SET", entityType: "User", entityId: coachUserId, newValue: { shareBps: null }, reason });
  });
}

export async function updateWalletSettings(db: PrismaClient, actor: Actor, raw: z.input<typeof SETTING_SCHEMAS.coachWallet>, reason?: string) {
  authorize(actor, "wallet.manage");
  const next = SETTING_SCHEMAS.coachWallet.parse(raw);
  await db.$transaction(async (tx) => {
    const previous = await settingRepository.get(tx, "coachWallet");
    await settingRepository.upsert(tx, "coachWallet", next, actor.userId);
    await audit(tx, { actor, action: "WALLET_SETTINGS_SET", entityType: "Setting", entityId: "coachWallet", previousValue: previous?.value, newValue: next, reason });
  });
  return next;
}

export async function walletSettings(db: PrismaClient, actor: Actor) {
  authorize(actor, "wallet.manage");
  return getSetting(db, "coachWallet");
}

export type RevenueRow = { coachUserId: string; coachEmail: string; sales: number; saleMinor: number; refundedMinor: number; feeMinor: number; feeAbsorbedMinor: number; coachMinor: number; affiliateMinor: number; platformNetMinor: number };

/**
 * Platform revenue for a date range, in total and by coach. Per sale, the platform's net is its share minus the
 * affiliate commission, with refunded parts removed in proportion, minus any gateway fee it absorbed on a refund.
 * Sales still waiting for their fee are counted in sales and amount but contribute nothing else yet.
 */
export async function platformRevenueReport(db: PrismaClient, actor: Actor, f: { from?: string; to?: string; coachUserId?: string } = {}) {
  authorize(actor, "wallet.manage");
  const { from, to } = range({ from: f.from, to: f.to });
  const rows = await walletRepository.earningsInRange(db, { from, to, coachUserId: f.coachUserId || undefined });
  const by = new Map<string, RevenueRow>();
  for (const e of rows) {
    const r = by.get(e.coachUserId) ?? { coachUserId: e.coachUserId, coachEmail: e.coach.email, sales: 0, saleMinor: 0, refundedMinor: 0, feeMinor: 0, feeAbsorbedMinor: 0, coachMinor: 0, affiliateMinor: 0, platformNetMinor: 0 };
    r.sales++;
    r.saleMinor += e.saleAmount;
    r.refundedMinor += e.refundedSaleMinor;
    if (e.status !== "PENDING_FEE") {
      const keptPlatform = (e.platformAmount ?? 0) - proportionalShare(e.platformAmount ?? 0, e.refundedSaleMinor, e.saleAmount);
      const keptAffiliate = e.affiliateAmount - proportionalShare(e.affiliateAmount, e.refundedSaleMinor, e.saleAmount);
      r.feeMinor += e.gatewayFee ?? 0;
      r.feeAbsorbedMinor += e.feeAbsorbedMinor;
      r.coachMinor += (e.coachAmount ?? 0) - e.coachReversedMinor;
      r.affiliateMinor += keptAffiliate;
      r.platformNetMinor += keptPlatform - keptAffiliate - e.feeAbsorbedMinor;
    }
    by.set(e.coachUserId, r);
  }
  const perCoach = [...by.values()].sort((a, b) => b.saleMinor - a.saleMinor);
  const total = perCoach.reduce<RevenueRow>((t, r) => ({ ...t, sales: t.sales + r.sales, saleMinor: t.saleMinor + r.saleMinor, refundedMinor: t.refundedMinor + r.refundedMinor, feeMinor: t.feeMinor + r.feeMinor, feeAbsorbedMinor: t.feeAbsorbedMinor + r.feeAbsorbedMinor, coachMinor: t.coachMinor + r.coachMinor, affiliateMinor: t.affiliateMinor + r.affiliateMinor, platformNetMinor: t.platformNetMinor + r.platformNetMinor }), { coachUserId: "", coachEmail: "All coaches", sales: 0, saleMinor: 0, refundedMinor: 0, feeMinor: 0, feeAbsorbedMinor: 0, coachMinor: 0, affiliateMinor: 0, platformNetMinor: 0 });
  return { currency: WALLET_CURRENCY, total, perCoach };
}
