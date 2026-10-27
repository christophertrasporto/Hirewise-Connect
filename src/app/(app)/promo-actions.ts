"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { toActionError, formList, formString, type ActionResult } from "@/server/http/action-result";
import { applyPromoToEnrollment, createPromo, previewPromo, removePromoFromEnrollment, setPromoStatus, updatePromo, type PromoQuote } from "@/server/services/promo.service";

// Learner

/** Called from the course page as the learner types a code: shows the new price, changes nothing. */
export async function previewPromoAction(courseId: string, code: string): Promise<ActionResult<PromoQuote>> {
  try {
    const actor = await requireActor();
    return { ok: true, data: await previewPromo(prisma, actor, courseId, code) };
  } catch (e) {
    return toActionError(e);
  }
}

export async function applyPromoAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await applyPromoToEnrollment(prisma, actor, formString(fd, "enrollmentId"), formString(fd, "promoCode"));
    revalidatePath("/courses", "layout");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function removePromoAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await removePromoFromEnrollment(prisma, actor, formString(fd, "enrollmentId"));
    revalidatePath("/courses", "layout");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

// Staff

function promoFields(fd: FormData) {
  return {
    code: formString(fd, "code"),
    label: formString(fd, "label"),
    discountType: formString(fd, "discountType") as "PERCENT" | "AMOUNT",
    percent: formString(fd, "percent"),
    amount: formString(fd, "amount"),
    currency: (formString(fd, "currency") || "PHP") as "PHP" | "USD",
    startsOn: formString(fd, "startsOn"),
    endsOn: formString(fd, "endsOn"),
    maxRedemptions: formString(fd, "maxRedemptions"),
    perLearnerLimit: formString(fd, "perLearnerLimit") || "1",
    minPrice: formString(fd, "minPrice"),
    appliesTo: (formString(fd, "appliesTo") || "ALL_COURSES") as "ALL_COURSES" | "SELECTED_COURSES",
    courseIds: formList(fd, "courseIds"),
  };
}

export async function createPromoAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await createPromo(prisma, actor, promoFields(fd));
    revalidatePath("/staff/academy/promos");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updatePromoAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await updatePromo(prisma, actor, formString(fd, "promoId"), promoFields(fd));
    revalidatePath("/staff/academy/promos");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function setPromoStatusAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await setPromoStatus(prisma, actor, formString(fd, "promoId"), formString(fd, "status") as "ACTIVE" | "PAUSED" | "ARCHIVED");
    revalidatePath("/staff/academy/promos");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}
