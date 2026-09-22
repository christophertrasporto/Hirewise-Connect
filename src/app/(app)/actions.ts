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
import { addToShortlist, removeFromShortlist, setShortlistNote } from "@/server/services/shortlist.service";
import { reviewMedia, mediaDecisionSchema } from "@/server/services/media.service";
import { addNote, noteInputSchema } from "@/server/services/note.service";
import { createRequirement, requirementSchema } from "@/server/services/requirement.service";
import { createInterviewRequest, interviewRequestSchema, startSalesReview, proposeSlots, clientConfirmSlots, candidateRespond, cancelRequest, setSalesNotes, scheduleInterviews, scheduleSchema, completeInterview, recordClientDecision, decisionSchema } from "@/server/services/interview.service";
import { postMessage, reviewHeldMessage, markFlagReviewed } from "@/server/services/message.service";
import { reserveForClient, extendReservation, releaseReservation } from "@/server/services/reservation.service";

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

// ---------------------------------------------------------------------------
// Marketplace (Phase 1B)
// ---------------------------------------------------------------------------

export async function toggleShortlistAction(_prev: ActionResult<{ shortlisted: boolean }>, fd: FormData): Promise<ActionResult<{ shortlisted: boolean }>> {
  try {
    const actor = await requireActor();
    const id = formString(fd, "agentProfileId");
    const shortlisted = fd.get("shortlisted") === "true";
    if (shortlisted) await removeFromShortlist(prisma, actor, id);
    else await addToShortlist(prisma, actor, id);
    revalidatePath("/talent", "layout");
    revalidatePath("/shortlist", "layout");
    revalidatePath("/dashboard");
    return { ok: true, data: { shortlisted: !shortlisted } };
  } catch (e) {
    return toActionError(e);
  }
}

export async function shortlistNoteAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await setShortlistNote(prisma, actor, formString(fd, "agentProfileId"), formString(fd, "note"));
    revalidatePath("/shortlist", "layout");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function reviewMediaAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await reviewMedia(prisma, actor, mediaDecisionSchema.parse({ type: formString(fd, "type"), id: formString(fd, "id"), decision: formString(fd, "decision"), feedback: formString(fd, "feedback") }));
    revalidatePath("/staff/media");
    revalidatePath("/staff/talent", "layout");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function addNoteAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const subjectType = formString(fd, "subjectType") === "CLIENT" ? "CLIENT" : "AGENT";
    await addNote(prisma, actor, subjectType, formString(fd, "subjectId"), noteInputSchema.parse({ body: formString(fd, "body"), visibility: formString(fd, "visibility") || "INTERNAL", pinned: fd.get("pinned") === "on" }));
    revalidatePath("/staff/talent", "layout");
    revalidatePath("/staff/clients");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

// ---------------------------------------------------------------------------
// Phase 2: requirements, interview requests, messages, reservations
// ---------------------------------------------------------------------------

export async function createRequirementAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await createRequirement(prisma, actor, requirementSchema.parse({
      title: formString(fd, "title"), role: formString(fd, "role"), jobDescription: formString(fd, "jobDescription"), skills: formList(fd, "skills"), industry: formString(fd, "industry"),
      experienceLevel: formString(fd, "experienceLevel"), agentsRequired: formString(fd, "agentsRequired") || "1", schedule: formString(fd, "schedule"), timezone: formString(fd, "timezone"),
      software: formList(fd, "software"), startDate: formString(fd, "startDate"), budgetMin: formString(fd, "budgetMin"), budgetMax: formString(fd, "budgetMax"), otherRequirements: formString(fd, "otherRequirements"),
    }));
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath("/requirements");
  redirect("/requirements");
}

export async function createInterviewRequestAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  let id = "";
  try {
    const actor = await requireActor();
    id = await createInterviewRequest(prisma, actor, interviewRequestSchema.parse({
      candidateIds: formList(fd, "candidateIds"), requirementId: formString(fd, "requirementId"), preferredDate: formString(fd, "preferredDate"), preferredTime: formString(fd, "preferredTime"),
      timezone: formString(fd, "timezone"), notes: formString(fd, "notes"), role: formString(fd, "role"), schedule: formString(fd, "schedule"), targetStartDate: formString(fd, "targetStartDate"),
    }));
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath("/interviews");
  revalidatePath("/dashboard");
  redirect(`/interviews/${id}`);
}

function refreshRequest(id: string) {
  revalidatePath(`/interviews/${id}`);
  revalidatePath(`/staff/interviews/${id}`);
  revalidatePath("/interviews");
  revalidatePath("/staff/interviews");
  revalidatePath("/dashboard");
}

export async function requestWorkflowAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const id = formString(fd, "requestId");
  const op = formString(fd, "op");
  try {
    const actor = await requireActor();
    switch (op) {
      case "START_REVIEW": await startSalesReview(prisma, actor, id); break;
      case "PROPOSE": await proposeSlots(prisma, actor, id, formString(fd, "message")); break;
      case "CLIENT_CONFIRM": await clientConfirmSlots(prisma, actor, id, formString(fd, "message")); break;
      case "CANDIDATE_CONFIRM": await candidateRespond(prisma, actor, id, "CONFIRMED"); break;
      case "CANDIDATE_DECLINE": await candidateRespond(prisma, actor, id, "DECLINED"); break;
      case "CANCEL": await cancelRequest(prisma, actor, id, formString(fd, "reason")); break;
      case "SALES_NOTES": await setSalesNotes(prisma, actor, id, formString(fd, "salesNotes")); break;
      default: return { ok: false, error: "Unknown operation." };
    }
    refreshRequest(id);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function scheduleInterviewsAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const id = formString(fd, "requestId");
  try {
    const actor = await requireActor();
    const agentIds = formList(fd, "agentProfileId");
    const items = agentIds.map((agentProfileId) => ({ agentProfileId, scheduledAt: formString(fd, `scheduledAt:${agentProfileId}`), durationMin: formString(fd, `durationMin:${agentProfileId}`) || "30", meetingLink: formString(fd, `meetingLink:${agentProfileId}`) })).filter((i) => i.scheduledAt);
    await scheduleInterviews(prisma, actor, id, scheduleSchema.parse({ items, timezone: formString(fd, "timezone") }));
    refreshRequest(id);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function completeInterviewAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await completeInterview(prisma, actor, formString(fd, "interviewId"), formString(fd, "status") as "COMPLETED" | "NO_SHOW_CLIENT" | "NO_SHOW_AGENT" | "CANCELLED", formString(fd, "internalFeedback") || undefined);
    refreshRequest(formString(fd, "requestId"));
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function clientDecisionAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await recordClientDecision(prisma, actor, formString(fd, "interviewId"), decisionSchema.parse({ decision: formString(fd, "decision"), feedback: formString(fd, "feedback") }));
    refreshRequest(formString(fd, "requestId"));
    revalidatePath("/placements");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function postMessageAction(_prev: ActionResult<{ held: boolean; reasons: string[] }>, fd: FormData): Promise<ActionResult<{ held: boolean; reasons: string[] }>> {
  const id = formString(fd, "requestId");
  try {
    const actor = await requireActor();
    const visibleTo = formString(fd, "visibleTo") as "ALL" | "HIREWISE_ONLY" | "CLIENT_AND_HIREWISE" | "AGENT_AND_HIREWISE" | "";
    const r = await postMessage(prisma, actor, id, formString(fd, "body"), visibleTo || undefined);
    refreshRequest(id);
    return { ok: true, data: { held: r.held, reasons: r.reasons } };
  } catch (e) {
    return toActionError(e);
  }
}

export async function reviewHeldMessageAction(fd: FormData): Promise<void> {
  const actor = await requireActor();
  await reviewHeldMessage(prisma, actor, formString(fd, "messageId"), formString(fd, "decision") === "BLOCK" ? "BLOCK" : "RELEASE");
  revalidatePath("/staff/compliance");
  revalidatePath("/staff/interviews", "layout");
}

export async function markFlagReviewedAction(fd: FormData): Promise<void> {
  const actor = await requireActor();
  await markFlagReviewed(prisma, actor, formString(fd, "flagId"));
  revalidatePath("/staff/compliance");
}

export async function reservationAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const op = formString(fd, "op");
    if (op === "RESERVE") await reserveForClient(prisma, actor, { agentProfileId: formString(fd, "agentProfileId"), clientId: formString(fd, "clientId"), reason: formString(fd, "reason") || null });
    else if (op === "EXTEND") await extendReservation(prisma, actor, formString(fd, "reservationId"));
    else if (op === "RELEASE") await releaseReservation(prisma, actor, formString(fd, "reservationId"), formString(fd, "reason") || undefined);
    else return { ok: false, error: "Unknown operation." };
    revalidatePath("/staff/reservations");
    revalidatePath("/staff/talent", "layout");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}
