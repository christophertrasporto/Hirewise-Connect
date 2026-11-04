"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { toActionError, formString, type ActionResult } from "@/server/http/action-result";
import { startPayPalCheckout } from "@/server/services/paypal-payment.service";

/** Creates (or resumes) the learner's PayPal order and sends them to PayPal's approval page. */
export async function payWithPayPalAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  let url: string;
  try {
    const actor = await requireActor();
    url = (await startPayPalCheckout(prisma, actor, formString(fd, "enrollmentId"))).url;
  } catch (e) {
    return toActionError(e);
  }
  redirect(url);
}
