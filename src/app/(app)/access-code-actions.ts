"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { toActionError, formString, type ActionResult } from "@/server/http/action-result";
import { createAccessCode, redeemAccessCode, voidAccessCode } from "@/server/services/access-code.service";

/** Learner: enter a code on the course page. The course opens on success. */
export async function redeemAccessCodeAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const courseId = formString(fd, "courseId");
    await redeemAccessCode(prisma, actor, formString(fd, "code"), courseId || undefined);
    revalidatePath("/courses", "layout");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

/** Staff: issue a code after confirming the payment. The code itself is returned once for staff to copy (it also stays in the list). */
export async function createAccessCodeAction(_prev: ActionResult<{ code: string; courseTitle: string }>, fd: FormData): Promise<ActionResult<{ code: string; courseTitle: string }>> {
  try {
    const actor = await requireActor();
    const r = await createAccessCode(prisma, actor, {
      courseId: formString(fd, "courseId"),
      buyerEmail: formString(fd, "buyerEmail"),
      paymentReference: formString(fd, "paymentReference"),
      expiresInDays: formString(fd, "expiresInDays") || "30",
      note: formString(fd, "note"),
    });
    revalidatePath("/staff/academy/access-codes");
    return { ok: true, data: { code: r.code, courseTitle: r.courseTitle } };
  } catch (e) {
    return toActionError(e);
  }
}

export async function voidAccessCodeAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await voidAccessCode(prisma, actor, formString(fd, "id"), formString(fd, "reason"));
    revalidatePath("/staff/academy/access-codes");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}
