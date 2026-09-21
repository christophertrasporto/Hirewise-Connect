"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { toActionError, formList, formString, type ActionResult } from "@/server/http/action-result";
import { personalSchema, professionalSchema, skillsSchema, experienceSchema, updatePersonal, updateProfessional, updateSkills, addExperience, removeExperience, submitForReview, reviewTransition } from "@/server/services/agent.service";
import { createUploadUrl, uploadRequestSchema, confirmResumeUpload, confirmVideoUpload, confirmRecordingUpload, confirmPhotoUpload, recordingKindSchema, mediaDownloadUrl } from "@/server/services/media.service";
import { activateClient } from "@/server/services/client.service";
import { markNotificationRead } from "@/server/services/dashboard.service";

function refreshProfile() {
  revalidatePath("/profile", "layout");
  revalidatePath("/dashboard");
}

export async function savePersonalAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const input = personalSchema.parse({
      displayName: formString(fd, "displayName"),
      fullLegalName: formString(fd, "fullLegalName"),
      phone: formString(fd, "phone"),
      addressLine: formString(fd, "addressLine"),
      locationCity: formString(fd, "locationCity"),
      locationCountry: formString(fd, "locationCountry"),
      timezone: formString(fd, "timezone"),
      languages: formList(fd, "languages"),
      workSetup: formString(fd, "workSetup"),
      preferredShift: formString(fd, "preferredShift"),
      equipmentSummary: formString(fd, "equipmentSummary"),
      internetSummary: formString(fd, "internetSummary"),
    });
    await updatePersonal(prisma, actor, input);
    refreshProfile();
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function saveProfessionalAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const industries = formList(fd, "industry").map((industry, i) => ({ industry, years: formList(fd, "industryYears")[i] ?? "0" })).filter((x) => x.industry);
    const input = professionalSchema.parse({
      headline: formString(fd, "headline"),
      primaryRole: formString(fd, "primaryRole"),
      summary: formString(fd, "summary"),
      yearsExperience: formString(fd, "yearsExperience") || "0",
      experienceLevel: formString(fd, "experienceLevel"),
      industries,
    });
    await updateProfessional(prisma, actor, input);
    refreshProfile();
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function saveSkillsAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const skills: Array<{ skillId: string; level: string; yearsUsed?: string }> = [];
    const software: Array<{ softwareId: string; level: string }> = [];
    for (const [key, value] of fd.entries()) {
      if (typeof value !== "string" || !value) continue;
      if (key.startsWith("skill:")) skills.push({ skillId: key.slice(6), level: value, yearsUsed: formString(fd, `skillYears:${key.slice(6)}`) || undefined });
      if (key.startsWith("software:")) software.push({ softwareId: key.slice(9), level: value });
    }
    await updateSkills(prisma, actor, skillsSchema.parse({ skills, software }));
    refreshProfile();
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function addExperienceAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const input = experienceSchema.parse({
      company: formString(fd, "company"),
      title: formString(fd, "title"),
      industry: formString(fd, "industry"),
      startDate: formString(fd, "startDate"),
      endDate: formString(fd, "endDate"),
      description: formString(fd, "description"),
      isCampaign: fd.get("isCampaign") === "on",
      campaignType: formString(fd, "campaignType"),
    });
    await addExperience(prisma, actor, input);
    refreshProfile();
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function removeExperienceAction(fd: FormData): Promise<void> {
  const actor = await requireActor();
  await removeExperience(prisma, actor, formString(fd, "experienceId"));
  refreshProfile();
}

export async function submitProfileAction(_prev: ActionResult): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await submitForReview(prisma, actor);
    refreshProfile();
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

// ---------------------------------------------------------------------------
// Uploads: request a presigned URL, upload from the browser, then confirm.
// ---------------------------------------------------------------------------

export async function requestUploadAction(input: { kind: string; contentType: string; sizeBytes: number }): Promise<ActionResult<{ key: string; url: string; method: "PUT"; headers: Record<string, string> }>> {
  try {
    const actor = await requireActor();
    const r = await createUploadUrl(actor, uploadRequestSchema.parse(input));
    return { ok: true, data: r };
  } catch (e) {
    return toActionError(e);
  }
}

export async function confirmUploadAction(input: { kind: string; key: string; durationSec?: number | null; recordingKind?: string; title?: string }): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    switch (input.kind) {
      case "RESUME":
        await confirmResumeUpload(prisma, actor, input.key);
        break;
      case "PHOTO":
        await confirmPhotoUpload(prisma, actor, input.key);
        break;
      case "VIDEO":
        await confirmVideoUpload(prisma, actor, input.key, input.durationSec ?? null);
        break;
      case "RECORDING":
        await confirmRecordingUpload(prisma, actor, input.key, recordingKindSchema.parse(input.recordingKind), input.title ?? "", input.durationSec ?? null);
        break;
      default:
        return { ok: false, error: "Unknown upload kind." };
    }
    refreshProfile();
    revalidatePath("/staff/talent", "layout");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function mediaUrlAction(target: { type: "VIDEO" | "RECORDING" | "RESUME"; id: string }): Promise<ActionResult<{ url: string }>> {
  try {
    const actor = await requireActor();
    return { ok: true, data: { url: await mediaDownloadUrl(prisma, actor, target) } };
  } catch (e) {
    return toActionError(e);
  }
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export async function markReadAction(fd: FormData): Promise<void> {
  const actor = await requireActor();
  await markNotificationRead(prisma, actor, formString(fd, "id"));
  revalidatePath("/notifications");
  revalidatePath("/dashboard");
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export async function activateClientAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await activateClient(prisma, actor, formString(fd, "clientId"), { reason: formString(fd, "reason") || undefined });
    revalidatePath("/staff/clients");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function reviewAgentAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const id = formString(fd, "agentProfileId");
  try {
    const actor = await requireActor();
    const to = formString(fd, "to") as "UNDER_REVIEW" | "APPROVED" | "REVISION_REQUIRED" | "REJECTED" | "HIDDEN" | "SUSPENDED";
    await reviewTransition(prisma, actor, id, to, formString(fd, "reason") || undefined);
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath("/staff/talent", "layout");
  revalidatePath("/dashboard");
  redirect(`/staff/talent/${id}`);
}
