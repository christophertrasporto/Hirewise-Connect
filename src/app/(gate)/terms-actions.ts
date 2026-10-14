"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requestMeta } from "@/server/auth/cookies";
import { requireAuth, HOME_PATH } from "@/server/auth/require-actor";
import { acceptCurrentTerms } from "@/server/services/terms.service";
import { toActionError, type ActionResult } from "@/server/http/action-result";

/** Identity phase 1: the single-checkbox (re)acceptance of the unified terms at the agreements gate. */
export async function acceptTermsAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const auth = await requireAuth("email");
    if (fd.get("termsAccepted") !== "on") return { ok: false, error: "Tick the box to accept the Terms & Platform Agreement.", fieldErrors: { termsAccepted: "Required" } };
    await acceptCurrentTerms(prisma, auth.actor, await requestMeta());
  } catch (e) {
    return toActionError(e);
  }
  redirect(HOME_PATH);
}
