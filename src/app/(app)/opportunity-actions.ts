"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { toActionError, formString, formList, type ActionResult } from "@/server/http/action-result";
import { publishOpportunity, closeOpportunity, reviewSubmission, submitAgent, withdrawSubmission, requestInterviewsFromOpportunity } from "@/server/services/opportunity.service";

function refresh() {
  revalidatePath("/opportunities", "layout");
  revalidatePath("/agency", "layout");
  revalidatePath("/staff/opportunities", "layout");
  revalidatePath("/staff/requirements", "layout");
  revalidatePath("/dashboard");
}

export async function publishOpportunityAction(_prev: ActionResult<{ id: string }>, fd: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const o = await publishOpportunity(prisma, actor, { requirementId: formString(fd, "requirementId"), visibility: formString(fd, "visibility") as "ALL_AGENCIES" | "SELECTED_AGENCIES" | "DIRECT_ONLY", agencyIds: formList(fd, "agencyIds"), roleSummary: formString(fd, "roleSummary"), headcount: formString(fd, "headcount") || undefined });
    refresh();
    return { ok: true, data: { id: o.id } };
  } catch (e) {
    return toActionError(e);
  }
}

export async function closeOpportunityAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await closeOpportunity(prisma, actor, formString(fd, "opportunityId"), formString(fd, "status") === "FILLED" ? "FILLED" : "CLOSED", formString(fd, "reason"));
    refresh();
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function reviewSubmissionAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await reviewSubmission(prisma, actor, formString(fd, "submissionId"), formString(fd, "decision") === "DECLINE" ? "DECLINE" : "APPROVE", formString(fd, "note"));
    refresh();
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function submitAgentAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await submitAgent(prisma, actor, { opportunityId: formString(fd, "opportunityId"), agentProfileId: formString(fd, "agentProfileId"), note: formString(fd, "note") });
    refresh();
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function withdrawSubmissionAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await withdrawSubmission(prisma, actor, formString(fd, "submissionId"), formString(fd, "reason"));
    refresh();
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function requestInterviewsFromOpportunityAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  let id = "";
  try {
    const actor = await requireActor();
    id = await requestInterviewsFromOpportunity(prisma, actor, { opportunityId: formString(fd, "opportunityId"), agentProfileIds: formList(fd, "agentProfileIds"), timezone: formString(fd, "timezone"), notes: formString(fd, "notes"), requestedWindows: formString(fd, "requestedWindows") });
    refresh();
    revalidatePath("/interviews", "layout");
  } catch (e) {
    return toActionError(e);
  }
  redirect(`/interviews/${id}`);
}
