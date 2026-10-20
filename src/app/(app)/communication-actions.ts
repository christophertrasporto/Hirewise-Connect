"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { toActionError, formString, type ActionResult } from "@/server/http/action-result";
import { postToThread, openEnquiryThread, openSupportThread, closeThread } from "@/server/services/thread.service";
import { reportBypass, decideBypass, bypassEvidenceUploadUrl, attachBypassEvidence, bypassEvidenceUrl } from "@/server/services/bypass.service";

export type PostResult = { held: boolean; masked: boolean; reasons: string[] };

export async function postToThreadAction(_prev: ActionResult<PostResult>, fd: FormData): Promise<ActionResult<PostResult>> {
  try {
    const actor = await requireActor();
    const threadId = formString(fd, "threadId");
    const visibleTo = formString(fd, "visibleTo") as "ALL" | "HIREWISE_ONLY" | "CLIENT_AND_HIREWISE" | "AGENT_AND_HIREWISE" | "AGENCY_AND_HIREWISE" | "";
    const r = await postToThread(prisma, actor, threadId, formString(fd, "body"), visibleTo || undefined);
    revalidatePath(`/messages/${threadId}`);
    revalidatePath("/messages");
    revalidatePath("/interviews", "layout");
    revalidatePath("/staff/interviews", "layout");
    revalidatePath("/staff/compliance", "layout");
    return { ok: true, data: { held: r.held, masked: r.masked, reasons: r.reasons } };
  } catch (e) {
    return toActionError(e);
  }
}

export async function openEnquiryAction(fd: FormData): Promise<void> {
  const actor = await requireActor();
  const t = await openEnquiryThread(prisma, actor, formString(fd, "code"));
  redirect(`/messages/${t.id}`);
}

export async function openSupportAction(): Promise<void> {
  const actor = await requireActor();
  const t = await openSupportThread(prisma, actor);
  redirect(`/messages/${t.id}`);
}

export async function closeThreadAction(fd: FormData): Promise<void> {
  const actor = await requireActor();
  const threadId = formString(fd, "threadId");
  await closeThread(prisma, actor, threadId, formString(fd, "reason") || "Closed by Hirewise");
  revalidatePath(`/messages/${threadId}`);
  revalidatePath("/staff/compliance", "layout");
}

export async function reportBypassAction(_prev: ActionResult<{ id: string }>, fd: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const r = await reportBypass(prisma, actor, { description: formString(fd, "description"), reportedUserId: formString(fd, "reportedUserId"), reportedAgencyId: formString(fd, "reportedAgencyId"), reportedClientId: formString(fd, "reportedClientId"), relatedType: formString(fd, "relatedType"), relatedId: formString(fd, "relatedId") });
    revalidatePath("/report-bypass");
    revalidatePath("/staff/compliance", "layout");
    return { ok: true, data: { id: r.id } };
  } catch (e) {
    return toActionError(e);
  }
}

export async function decideBypassAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const id = formString(fd, "reportId");
    await decideBypass(prisma, actor, id, { to: formString(fd, "to") as "UNDER_REVIEW" | "WARNING_ISSUED" | "RESTRICTED" | "SUSPENDED" | "CLOSED", note: formString(fd, "note"), restrictionDays: formString(fd, "restrictionDays") || undefined, liftRestriction: formString(fd, "liftRestriction") === "on" });
    revalidatePath(`/staff/compliance/bypass/${id}`);
    revalidatePath("/staff/compliance", "layout");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function bypassEvidenceUploadUrlAction(reportId: string, contentType: string): Promise<ActionResult<{ key: string; url: string; method: "PUT"; headers: Record<string, string> }>> {
  try {
    const actor = await requireActor();
    return { ok: true, data: await bypassEvidenceUploadUrl(prisma, actor, reportId, contentType) };
  } catch (e) {
    return toActionError(e);
  }
}

export async function attachBypassEvidenceAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const id = formString(fd, "reportId");
    await attachBypassEvidence(prisma, actor, id, formString(fd, "storageKey"));
    revalidatePath(`/staff/compliance/bypass/${id}`);
    revalidatePath("/report-bypass");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function bypassEvidenceUrlAction(reportId: string, documentId: string): Promise<ActionResult<{ url: string }>> {
  try {
    const actor = await requireActor();
    return { ok: true, data: { url: await bypassEvidenceUrl(prisma, actor, reportId, documentId) } };
  } catch (e) {
    return toActionError(e);
  }
}
