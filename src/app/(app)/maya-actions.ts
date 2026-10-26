"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { toActionError, formString, type ActionResult } from "@/server/http/action-result";
import { startMayaCheckout } from "@/server/services/maya-payment.service";

/** Creates (or resumes) the learner's Maya checkout and sends them to Maya's page. */
export async function payWithMayaAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  let url: string;
  try {
    const actor = await requireActor();
    url = (await startMayaCheckout(prisma, actor, formString(fd, "enrollmentId"))).url;
  } catch (e) {
    return toActionError(e);
  }
  redirect(url);
}
