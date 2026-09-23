"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { requestMeta } from "@/server/auth/cookies";
import { toActionError, formString, type ActionResult } from "@/server/http/action-result";
import { billingRateSchema, compensationSchema, proposeBillingRate, decideBillingRate, retireBillingRate, setCompensation } from "@/server/services/rate.service";
import { approvePlacement, acceptServiceAgreement, recordSignedAgreement, signedAgreementUploadUrl, setChecklistItem, setStartDate, activatePlacement, transitionPlacement } from "@/server/services/placement.service";
import { paymentSchema, depositPolicySchema, recordPayment, waiveDeposit, changeDepositPolicy, voidInvoice, invoicePdfUrl, saveDepositPolicy } from "@/server/services/billing.service";

function refreshPlacement(id: string) {
  revalidatePath(`/staff/placements/${id}`);
  revalidatePath("/staff/placements");
  revalidatePath(`/placements/${id}`);
  revalidatePath("/placements");
  revalidatePath("/billing", "layout");
  revalidatePath("/dashboard");
}

// --- Rates -----------------------------------------------------------------

export async function proposeRateAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const input = billingRateSchema.parse({ agentProfileId: formString(fd, "agentProfileId"), amountUsd: formString(fd, "amountUsd"), currency: formString(fd, "currency") || "USD", unit: formString(fd, "unit"), positioningNotes: formString(fd, "positioningNotes") });
    await proposeBillingRate(prisma, actor, input);
    revalidatePath(`/staff/talent/${input.agentProfileId}`);
    revalidatePath("/staff/commercial", "layout");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function decideRateAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const op = formString(fd, "op");
    const rateId = formString(fd, "rateId");
    if (op === "PUBLISH" || op === "REJECT") await decideBillingRate(prisma, actor, rateId, op, formString(fd, "reason") || undefined);
    else if (op === "RETIRE") await retireBillingRate(prisma, actor, rateId, formString(fd, "reason"));
    else return { ok: false, error: "Unknown operation." };
    revalidatePath("/staff/commercial", "layout");
    revalidatePath("/staff/talent", "layout");
    revalidatePath("/talent", "layout");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function setCompensationAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const input = compensationSchema.parse({ agentProfileId: formString(fd, "agentProfileId"), amountUsd: formString(fd, "amountUsd"), currency: formString(fd, "currency") || "USD", unit: formString(fd, "unit"), notes: formString(fd, "notes") });
    await setCompensation(prisma, actor, input, formString(fd, "reason") || undefined);
    revalidatePath(`/staff/talent/${input.agentProfileId}`);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

// --- Placement pipeline ----------------------------------------------------

export async function placementWorkflowAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const id = formString(fd, "placementId");
    const op = formString(fd, "op");
    const reason = formString(fd, "reason") || undefined;
    if (op === "APPROVE") await approvePlacement(prisma, actor, id, { depositPolicyId: formString(fd, "depositPolicyId") || null, customDepositUsd: formString(fd, "customDepositUsd") || null, startDate: formString(fd, "startDate") || null });
    else if (op === "ACCEPT_AGREEMENT") await acceptServiceAgreement(prisma, actor, id, await requestMeta());
    else if (op === "SIGNED_AGREEMENT") await recordSignedAgreement(prisma, actor, id, formString(fd, "storageKey"));
    else if (op === "START_DATE") await setStartDate(prisma, actor, id, formString(fd, "startDate"));
    else if (op === "ACTIVATE") await activatePlacement(prisma, actor, id);
    else if (op === "PAUSE" || op === "RESUME" || op === "COMPLETE" || op === "CANCEL") await transitionPlacement(prisma, actor, id, op === "PAUSE" ? "PAUSED" : op === "RESUME" ? "ACTIVE" : op === "COMPLETE" ? "COMPLETED" : "CANCELLED", reason);
    else return { ok: false, error: "Unknown operation." };
    refreshPlacement(id);
    revalidatePath("/staff/talent", "layout");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function checklistAction(fd: FormData): Promise<void> {
  try {
    const actor = await requireActor();
    await setChecklistItem(prisma, actor, formString(fd, "itemId"), formString(fd, "done") === "true");
    refreshPlacement(formString(fd, "placementId"));
  } catch {
    // The page re-renders with the unchanged state; errors are not user-facing here.
  }
}

export async function signedAgreementUrlAction(placementId: string, contentType: string): Promise<ActionResult<{ key: string; url: string; method: "PUT"; headers: Record<string, string> }>> {
  try {
    const actor = await requireActor();
    return { ok: true, data: await signedAgreementUploadUrl(prisma, actor, placementId, contentType) };
  } catch (e) {
    return toActionError(e);
  }
}

// --- Billing ---------------------------------------------------------------

export async function recordPaymentAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const input = paymentSchema.parse({ invoiceId: formString(fd, "invoiceId"), amountUsd: formString(fd, "amountUsd"), method: formString(fd, "method"), reference: formString(fd, "reference"), paidAt: formString(fd, "paidAt") });
    await recordPayment(prisma, actor, input);
    revalidatePath("/staff/commercial", "layout");
    if (formString(fd, "placementId")) refreshPlacement(formString(fd, "placementId"));
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function depositAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const op = formString(fd, "op");
    if (op === "WAIVE") await waiveDeposit(prisma, actor, formString(fd, "depositId"), formString(fd, "reason"));
    else if (op === "RECALCULATE") await changeDepositPolicy(prisma, actor, formString(fd, "depositId"), formString(fd, "policyId"), formString(fd, "customUsd") || undefined);
    else if (op === "VOID_INVOICE") await voidInvoice(prisma, actor, formString(fd, "invoiceId"), formString(fd, "reason"));
    else return { ok: false, error: "Unknown operation." };
    revalidatePath("/staff/commercial", "layout");
    if (formString(fd, "placementId")) refreshPlacement(formString(fd, "placementId"));
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function invoicePdfAction(invoiceId: string): Promise<ActionResult<{ url: string }>> {
  try {
    const actor = await requireActor();
    return { ok: true, data: { url: await invoicePdfUrl(prisma, actor, invoiceId) } };
  } catch (e) {
    return toActionError(e);
  }
}

export async function saveDepositPolicyAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await saveDepositPolicy(prisma, actor, depositPolicySchema.parse({ id: formString(fd, "id") || undefined, name: formString(fd, "name"), type: formString(fd, "type"), value: formString(fd, "value"), currency: formString(fd, "currency"), isDefault: fd.get("isDefault") === "on", isActive: fd.get("isActive") === "on" }));
    revalidatePath("/staff/commercial", "layout");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}
