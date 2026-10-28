"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { toActionError, formString, type ActionResult } from "@/server/http/action-result";
import { parseMoneyToMinor } from "@/lib/coach-wallet";
import { adjustWallet, clearCoachShareOverride, decideWithdrawal, importSettlementFees, requestWithdrawal, saveMyPayoutDetails, setCoachShareOverride, setGatewayFee, updateWalletSettings, type FeeImportResult } from "@/server/services/wallet.service";

// Coach

export async function savePayoutDetailsAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await saveMyPayoutDetails(prisma, actor, { method: formString(fd, "method") as "GCASH" | "MAYA" | "BANK_TRANSFER", accountName: formString(fd, "accountName"), accountNumber: formString(fd, "accountNumber"), bankName: formString(fd, "bankName") });
    revalidatePath("/wallet");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function requestWithdrawalAction(_prev: ActionResult): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await requestWithdrawal(prisma, actor);
    revalidatePath("/wallet");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

// Staff (wallet.manage)

export async function decideWithdrawalAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const outcome = formString(fd, "outcome");
    await decideWithdrawal(prisma, actor, formString(fd, "withdrawalId"), outcome === "PAID" ? { outcome: "PAID", reference: formString(fd, "reference") } : outcome === "REJECTED" ? { outcome: "REJECTED", reason: formString(fd, "reason") } : { outcome: "APPROVED" });
    revalidatePath("/staff/wallet", "layout");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function setFeeAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const fee = parseMoneyToMinor(formString(fd, "fee"));
    if (fee === null) return { ok: false, error: "Enter the fee like 102.47.", fieldErrors: { fee: "Enter the fee like 102.47." } };
    await setGatewayFee(prisma, actor, formString(fd, "earningId"), fee);
    revalidatePath("/staff/wallet", "layout");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function importFeesAction(_prev: ActionResult<FeeImportResult>, fd: FormData): Promise<ActionResult<FeeImportResult>> {
  try {
    const actor = await requireActor();
    const file = fd.get("file");
    const text = file instanceof File && file.size > 0 ? await file.text() : formString(fd, "csv");
    if (!text.trim()) return { ok: false, error: "Choose the settlement report file or paste its rows." };
    if (text.length > 2_000_000) return { ok: false, error: "That file is too large. Import it in parts." };
    const result = await importSettlementFees(prisma, actor, text);
    revalidatePath("/staff/wallet", "layout");
    return { ok: !result.headerError, data: result, error: result.headerError };
  } catch (e) {
    return toActionError<FeeImportResult>(e);
  }
}

export async function adjustWalletAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const amount = parseMoneyToMinor(formString(fd, "amount"));
    if (amount === null || amount === 0) return { ok: false, error: "Enter an amount like 250 or 99.50.", fieldErrors: { amount: "Enter an amount like 250 or 99.50." } };
    await adjustWallet(prisma, actor, { coachUserId: formString(fd, "coachUserId"), amountMinor: formString(fd, "direction") === "DEBIT" ? -amount : amount, note: formString(fd, "note") });
    revalidatePath("/staff/wallet", "layout");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function setOverrideAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    if (formString(fd, "intent") === "clear") await clearCoachShareOverride(prisma, actor, formString(fd, "coachUserId"), formString(fd, "note"));
    else await setCoachShareOverride(prisma, actor, { coachUserId: formString(fd, "coachUserId"), percent: formString(fd, "percent"), note: formString(fd, "note") });
    revalidatePath("/staff/wallet", "layout");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateWalletSettingsAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const percent = Number(formString(fd, "sharePercent"));
    const money = parseMoneyToMinor(formString(fd, "minimumWithdrawal"));
    if (!Number.isFinite(percent) || money === null) return { ok: false, error: "Check the share percentage and the minimum withdrawal.", fieldErrors: { sharePercent: Number.isFinite(percent) ? "" : "Enter a percentage like 60.", minimumWithdrawal: money === null ? "Enter an amount like 500." : "" } };
    await updateWalletSettings(prisma, actor, { coachShareBps: Math.round(percent * 100), refundWindowDays: Number(formString(fd, "refundWindowDays")), holdBufferDays: Number(formString(fd, "holdBufferDays")), minimumWithdrawalMinor: money, showBuyerEmail: fd.get("showBuyerEmail") === "on" }, formString(fd, "reason") || undefined);
    revalidatePath("/staff/wallet", "layout");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}
