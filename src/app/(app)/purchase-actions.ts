"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { toActionError, formString, type ActionResult } from "@/server/http/action-result";
import { startPurchase, type PurchaseMethod } from "@/server/services/purchase.service";
import { revalidatePublicAcademy } from "@/app/public-academy-cache";

const METHODS: PurchaseMethod[] = ["MAYA", "PAYPAL", "OFFLINE"];

/**
 * The checkout screen's one button: enrol (with the promo code, if any), then go to the chosen gateway, or open the
 * course when it is free or already paid, or show the offline payment instructions on the course page.
 */
export async function startPurchaseAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const courseId = formString(fd, "courseId");
  let to: string;
  try {
    const actor = await requireActor();
    const method = formString(fd, "method") as PurchaseMethod;
    const r = await startPurchase(prisma, actor, { courseId, promoCode: formString(fd, "promoCode"), method: METHODS.includes(method) ? method : "OFFLINE" });
    revalidatePublicAcademy();
    revalidatePath("/courses");
    revalidatePath(`/courses/${courseId}`);
    to = r.kind === "REDIRECT" ? r.url : `/courses/${courseId}`;
  } catch (e) {
    return toActionError(e);
  }
  redirect(to);
}
