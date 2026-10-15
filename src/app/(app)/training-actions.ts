"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { requestMeta } from "@/server/auth/cookies";
import { purchaseCourseSeats, recordCoursePurchase, assignCourse } from "@/server/services/training.service";
import { applyIndependent, recordIndependentAccess } from "@/server/services/independent.service";
import { toActionError, formString, type ActionResult } from "@/server/http/action-result";

export async function purchaseCourseSeatsAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await purchaseCourseSeats(prisma, actor, { courseId: formString(fd, "courseId"), seatCount: formString(fd, "seatCount"), note: formString(fd, "note") });
    revalidatePath("/agency/training");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function assignCourseAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await assignCourse(prisma, actor, { courseId: formString(fd, "courseId"), agentProfileId: formString(fd, "agentProfileId") });
    revalidatePath("/agency/training");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function recordCoursePurchaseAction(_prev: ActionResult<{ status: string }>, fd: FormData): Promise<ActionResult<{ status: string }>> {
  try {
    const actor = await requireActor();
    const r = await recordCoursePurchase(prisma, actor, formString(fd, "purchaseId"), { outcome: formString(fd, "outcome") as "PAID" | "WAIVED" | "CANCELLED", reference: formString(fd, "reference"), note: formString(fd, "note") });
    revalidatePath("/staff/agencies/seats");
    return { ok: true, data: { status: r.status } };
  } catch (e) {
    return toActionError(e);
  }
}

/** v2 phase 4: a former agency agent applies as an independent freelancer. */
export async function applyIndependentAction(_prev: ActionResult<{ status: string }>, fd: FormData): Promise<ActionResult<{ status: string }>> {
  try {
    const actor = await requireActor();
    const r = await applyIndependent(prisma, actor, { termsAccepted: fd.get("termsAccepted") === "on" }, await requestMeta());
    revalidatePath("/dashboard");
    return { ok: true, data: { status: r.status } };
  } catch (e) {
    return toActionError(e);
  }
}

export async function recordIndependentAccessAction(_prev: ActionResult<{ status: string }>, fd: FormData): Promise<ActionResult<{ status: string }>> {
  try {
    const actor = await requireActor();
    const r = await recordIndependentAccess(prisma, actor, formString(fd, "accessId"), { outcome: formString(fd, "outcome") as "PAID" | "WAIVED" | "CANCELLED", reference: formString(fd, "reference"), note: formString(fd, "note") });
    revalidatePath("/staff/agencies/seats");
    return { ok: true, data: { status: r.status } };
  } catch (e) {
    return toActionError(e);
  }
}
