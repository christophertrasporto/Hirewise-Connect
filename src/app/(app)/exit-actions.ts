"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { requestMeta } from "@/server/auth/cookies";
import { requestLeave, cancelLeave, requestRemoval, agencyDecide, adminDecide } from "@/server/services/exit.service";
import { toActionError, formString, type ActionResult } from "@/server/http/action-result";

/** v2 phase 3: the agent asks to leave; never a direct "leave" button. */
export async function requestLeaveAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await requestLeave(prisma, actor, { reason: formString(fd, "reason"), effectiveOption: (formString(fd, "effectiveOption") || "IMMEDIATE") as "IMMEDIATE", requestedEffectiveDate: formString(fd, "requestedEffectiveDate") }, await requestMeta());
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function cancelLeaveAction(_prev: ActionResult, _fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await cancelLeave(prisma, actor, await requestMeta());
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function requestRemovalAction(_prev: ActionResult<{ status: string }>, fd: FormData): Promise<ActionResult<{ status: string }>> {
  try {
    const actor = await requireActor();
    const r = await requestRemoval(prisma, actor, { membershipId: formString(fd, "membershipId"), reason: formString(fd, "reason"), effectiveOption: (formString(fd, "effectiveOption") || "IMMEDIATE") as "IMMEDIATE", requestedEffectiveDate: formString(fd, "requestedEffectiveDate") }, await requestMeta());
    revalidatePath("/agency/team");
    return { ok: true, data: { status: r.status } };
  } catch (e) {
    return toActionError(e);
  }
}

export async function agencyExitDecisionAction(_prev: ActionResult<{ status: string }>, fd: FormData): Promise<ActionResult<{ status: string }>> {
  try {
    const actor = await requireActor();
    const r = await agencyDecide(prisma, actor, formString(fd, "requestId"), { decision: formString(fd, "decision") as "APPROVE" | "DECLINE", effectiveOption: (formString(fd, "effectiveOption") || undefined) as "IMMEDIATE" | undefined, note: formString(fd, "note") });
    revalidatePath("/agency/team");
    return { ok: true, data: { status: r.status } };
  } catch (e) {
    return toActionError(e);
  }
}

export async function adminExitDecisionAction(_prev: ActionResult<{ status: string }>, fd: FormData): Promise<ActionResult<{ status: string }>> {
  try {
    const actor = await requireActor();
    const r = await adminDecide(prisma, actor, formString(fd, "requestId"), { decision: formString(fd, "decision") as "APPROVE" | "DECLINE", effectiveOption: (formString(fd, "effectiveOption") || undefined) as "IMMEDIATE" | undefined, note: formString(fd, "note") });
    revalidatePath("/staff/agencies/exits");
    return { ok: true, data: { status: r.status } };
  } catch (e) {
    return toActionError(e);
  }
}
