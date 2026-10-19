"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { requestMeta } from "@/server/auth/cookies";
import { toActionError, formString, formList, type ActionResult } from "@/server/http/action-result";
import { submitApplication, updateApplication, resubmitApplication, withdrawApplication, createApplicationUploadUrl, attachApplicationDocument, removeApplicationDocument, startReview, saveReviewNotes, requestMoreInfo, approveApplication, rejectApplication, documentUploadRequestSchema } from "@/server/services/agency-application.service";
import { updateAgencyProfile, setAgencyStatus, createAgencyDirect, setAgentAgency } from "@/server/services/agency.service";

function applicationInput(fd: FormData) {
  return {
    applicantFullName: formString(fd, "applicantFullName"),
    applicantPhone: formString(fd, "applicantPhone"),
    proposedAgencyName: formString(fd, "proposedAgencyName"),
    businessRegistration: formString(fd, "businessRegistration"),
    country: formString(fd, "country"),
    city: formString(fd, "city"),
    website: formString(fd, "website"),
    socialLinks: formString(fd, "socialLinks").split(/\r?\n|,/).map((s) => s.trim()).filter(Boolean),
    preferredPlanKey: formString(fd, "preferredPlanKey"), teamSize: formString(fd, "teamSize") || "0",
    yearsExperience: formString(fd, "yearsExperience") || "0",
    services: formList(fd, "services"),
    description: formString(fd, "description"),
  };
}

function revalidateApplicant() {
  revalidatePath("/apply/agency");
  revalidatePath("/dashboard");
  revalidatePath("/staff/agencies", "layout");
}

// ---------------------------------------------------------------------------
// Applicant
// ---------------------------------------------------------------------------

export async function submitApplicationAction(_prev: ActionResult<{ id: string }>, fd: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const id = await submitApplication(prisma, actor, { ...applicationInput(fd), agreementAccepted: fd.getAll("agreementAccepted").includes("on") }, await requestMeta());
    revalidateApplicant();
    return { ok: true, data: { id } };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateApplicationAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const id = formString(fd, "applicationId");
    await updateApplication(prisma, actor, id, applicationInput(fd));
    if (formString(fd, "intent") === "resubmit") await resubmitApplication(prisma, actor, id);
    revalidateApplicant();
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function withdrawApplicationAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await withdrawApplication(prisma, actor, formString(fd, "applicationId"));
    revalidateApplicant();
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function requestApplicationUploadAction(input: { applicationId: string; contentType: string; sizeBytes: number; fileName: string }): Promise<ActionResult<{ key: string; url: string; method: "PUT"; headers: Record<string, string> }>> {
  try {
    const actor = await requireActor();
    const r = await createApplicationUploadUrl(prisma, actor, input.applicationId, documentUploadRequestSchema.parse(input));
    return { ok: true, data: r };
  } catch (e) {
    return toActionError(e);
  }
}

export async function attachApplicationDocumentAction(input: { applicationId: string; storageKey: string }): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const id = await attachApplicationDocument(prisma, actor, input.applicationId, input.storageKey);
    revalidateApplicant();
    return { ok: true, data: { id } };
  } catch (e) {
    return toActionError(e);
  }
}

export async function removeApplicationDocumentAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await removeApplicationDocument(prisma, actor, formString(fd, "applicationId"), formString(fd, "documentId"));
    revalidateApplicant();
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

// ---------------------------------------------------------------------------
// Hirewise review
// ---------------------------------------------------------------------------

function revalidateStaff(applicationId?: string) {
  revalidatePath("/staff/agencies", "layout");
  if (applicationId) revalidatePath(`/staff/agencies/applications/${applicationId}`);
  revalidatePath("/apply/agency");
  revalidatePath("/dashboard");
}

export async function reviewDecisionAction(_prev: ActionResult<{ agencyId?: string }>, fd: FormData): Promise<ActionResult<{ agencyId?: string }>> {
  try {
    const actor = await requireActor();
    const id = formString(fd, "applicationId");
    const decision = formString(fd, "decision");
    const input = { message: formString(fd, "message"), notes: formString(fd, "notes"), reapplyAfterDays: formString(fd, "reapplyAfterDays") };
    let agencyId: string | undefined;
    if (decision === "START") await startReview(prisma, actor, id, input.notes || undefined);
    else if (decision === "NOTES") await saveReviewNotes(prisma, actor, id, input.notes);
    else if (decision === "NEEDS_MORE_INFO") await requestMoreInfo(prisma, actor, id, input);
    else if (decision === "APPROVE") agencyId = await approveApplication(prisma, actor, id, input);
    else if (decision === "REJECT") await rejectApplication(prisma, actor, id, input);
    else return { ok: false, error: "Unknown decision." };
    revalidateStaff(id);
    return { ok: true, data: { agencyId } };
  } catch (e) {
    return toActionError(e);
  }
}

export async function agencyStatusAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const to = formString(fd, "status");
    if (to !== "ACTIVE" && to !== "SUSPENDED" && to !== "INACTIVE") return { ok: false, error: "Unknown status." };
    await setAgencyStatus(prisma, actor, formString(fd, "agencyId"), to, formString(fd, "reason"));
    revalidateStaff();
    revalidatePath("/agency", "layout");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function createAgencyDirectAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  let id: string;
  try {
    const actor = await requireActor();
    id = await createAgencyDirect(prisma, actor, { ownerEmail: formString(fd, "ownerEmail"), name: formString(fd, "name"), description: formString(fd, "description"), contactEmail: formString(fd, "contactEmail"), contactPhone: formString(fd, "contactPhone"), country: formString(fd, "country"), city: formString(fd, "city"), website: formString(fd, "website"), reason: formString(fd, "reason") });
    revalidateStaff();
  } catch (e) {
    return toActionError(e);
  }
  redirect(`/staff/agencies/${id}`);
}

export async function setAgentAgencyAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await setAgentAgency(prisma, actor, formString(fd, "agentProfileId"), formString(fd, "agencyId") || null, formString(fd, "reason"));
    revalidateStaff();
    revalidatePath("/staff/talent", "layout");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

// ---------------------------------------------------------------------------
// Agency portal
// ---------------------------------------------------------------------------

export async function updateAgencyProfileAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await updateAgencyProfile(prisma, actor, formString(fd, "agencyId"), { name: formString(fd, "name"), description: formString(fd, "description"), contactEmail: formString(fd, "contactEmail"), contactPhone: formString(fd, "contactPhone"), country: formString(fd, "country"), city: formString(fd, "city"), website: formString(fd, "website"), legalName: formString(fd, "legalName"), addressLine: formString(fd, "addressLine"), registrationDetails: formString(fd, "registrationDetails"), billingEmail: formString(fd, "billingEmail") });
    revalidatePath("/agency", "layout");
    revalidateStaff();
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}
