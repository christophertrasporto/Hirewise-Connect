"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requestMeta } from "@/server/auth/cookies";
import { getCurrentAuth, nextGate, requireAuth, HOME_PATH } from "@/server/auth/require-actor";
import { acceptAgreement } from "@/server/services/agreement.service";
import { requestEmailVerification, beginMfaEnrollment, completeMfaEnrollment, verifyMfaForSession } from "@/server/services/auth.service";
import { toActionError, formString, type ActionResult } from "@/server/http/action-result";

export async function acceptAgreementAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const auth = await requireAuth("email");
    await acceptAgreement(prisma, auth.actor, formString(fd, "agreementId"), await requestMeta());
  } catch (e) {
    return toActionError(e);
  }
  // Re-evaluate: when nothing is missing any more, move on.
  const refreshed = await getCurrentAuth();
  if (refreshed && !nextGate(refreshed)) redirect(HOME_PATH);
  return { ok: true };
}

export async function resendVerificationAction(): Promise<ActionResult<{ devUrl?: string }>> {
  try {
    const auth = await requireAuth("mfa");
    const r = await requestEmailVerification(prisma, { userId: auth.actor.userId, email: auth.email, ...(await requestMeta()) });
    return { ok: true, data: { devUrl: r.devUrl } };
  } catch (e) {
    return toActionError(e);
  }
}

export async function beginMfaAction(): Promise<ActionResult<{ secretBase32: string; qrDataUrl: string }>> {
  try {
    const auth = await requireAuth("session");
    const r = await beginMfaEnrollment(prisma, auth.actor, auth.email);
    return { ok: true, data: r };
  } catch (e) {
    return toActionError(e);
  }
}

export async function completeMfaAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const auth = await requireAuth("session");
    await completeMfaEnrollment(prisma, auth.actor, auth.sessionId, formString(fd, "code"));
  } catch (e) {
    return toActionError(e);
  }
  redirect(HOME_PATH);
}

export async function verifyMfaAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const auth = await requireAuth("session");
    await verifyMfaForSession(prisma, auth.actor, auth.sessionId, formString(fd, "code"));
  } catch (e) {
    return toActionError(e);
  }
  redirect(HOME_PATH);
}
