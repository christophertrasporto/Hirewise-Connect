"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { toActionError, formString, type ActionResult } from "@/server/http/action-result";
import { savePayoutDetails, requestPayout, approvePayout, markPayoutPaid, rejectPayout } from "@/server/services/payout.service";
import { updateReferralSettings, reviewReferralFlag } from "@/server/services/referral-admin.service";
import { reverseCommissionManually, adjustReferrerBalance } from "@/server/services/commission.service";
import { recordCourseRefund } from "@/server/services/academy.service";
import { recordCoursePurchaseRefund } from "@/server/services/training.service";

/** Money typed in major units ("10.50", "-5") to integer minor units. Rejects anything that is not a plain decimal. */
function toMinor(raw: string, field: string): number {
  const s = raw.trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw Object.assign(new Error("Enter an amount like 10.50."), { name: "RegistrationError", field });
  const [whole, frac = ""] = s.replace("-", "").split(".");
  const minor = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  return s.startsWith("-") ? -minor : minor;
}

// ---- member ----

export async function savePayoutDetailsAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await savePayoutDetails(prisma, actor, { method: formString(fd, "method") as "GCASH" | "BANK_TRANSFER", accountName: formString(fd, "accountName"), accountNumber: formString(fd, "accountNumber"), bankName: formString(fd, "bankName") });
    revalidatePath("/refer");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function requestPayoutAction(_prev: ActionResult, _fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await requestPayout(prisma, actor);
    revalidatePath("/refer");
    revalidatePath("/staff/referrals", "layout");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

// ---- staff: settings, flags, commissions ----

export async function updateReferralSettingsAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const pct = Number(formString(fd, "ratePercent"));
    if (!Number.isFinite(pct)) throw Object.assign(new Error("Enter the commission rate as a percentage."), { name: "RegistrationError", field: "ratePercent" });
    await updateReferralSettings(prisma, actor, {
      commissionRateBps: Math.round(pct * 100),
      holdDays: Number(formString(fd, "holdDays")),
      cookieDays: Number(formString(fd, "cookieDays")),
      minimumPayoutMinor: toMinor(formString(fd, "minimumPayout") || "0", "minimumPayout"),
      payoutCurrency: formString(fd, "payoutCurrency").toUpperCase() || "USD",
    }, formString(fd, "reason") || undefined);
    revalidatePath("/staff/referrals", "layout");
    revalidatePath("/refer");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function reviewFlagAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await reviewReferralFlag(prisma, actor, formString(fd, "flagId"));
    revalidatePath("/staff/referrals", "layout");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function reverseCommissionAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await reverseCommissionManually(prisma, actor, formString(fd, "commissionId"), formString(fd, "note"));
    revalidatePath("/staff/referrals", "layout");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function adjustBalanceAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await adjustReferrerBalance(prisma, actor, { referrerId: formString(fd, "referrerId"), amountMinor: toMinor(formString(fd, "amount"), "amount"), note: formString(fd, "note") });
    revalidatePath("/staff/referrals", "layout");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

// ---- staff: payout queue ----

export async function payoutDecisionAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const id = formString(fd, "payoutId");
    const op = formString(fd, "op");
    if (op === "APPROVE") await approvePayout(prisma, actor, id);
    else if (op === "PAY") await markPayoutPaid(prisma, actor, id, { reference: formString(fd, "reference") });
    else if (op === "REJECT") await rejectPayout(prisma, actor, id, { reason: formString(fd, "reason") });
    else throw new Error("Unknown action.");
    revalidatePath("/staff/referrals", "layout");
    revalidatePath("/refer");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

// ---- staff: refunds and chargebacks ----

export async function recordRefundAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const input = { kind: formString(fd, "kind") as "REFUND" | "CHARGEBACK", reason: formString(fd, "reason") };
    if (formString(fd, "target") === "COURSE_PURCHASE") await recordCoursePurchaseRefund(prisma, actor, formString(fd, "id"), input);
    else await recordCourseRefund(prisma, actor, formString(fd, "id"), input);
    revalidatePath("/staff/academy", "layout");
    revalidatePath("/staff/agencies/seats");
    revalidatePath("/staff/referrals", "layout");
    revalidatePath("/refer");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}
