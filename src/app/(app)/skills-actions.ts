"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { toActionError, formString, formList, type ActionResult } from "@/server/http/action-result";
import { saveSkillTag, savePathway, requestSkillTag, decideTagRequest, setCourseSkillTags, setOpportunityRequirements } from "@/server/services/skills.service";

export async function saveSkillTagAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await saveSkillTag(prisma, actor, { id: formString(fd, "id"), name: formString(fd, "name"), category: formString(fd, "category"), description: formString(fd, "description"), isActive: fd.get("isActive") === "on", verificationMode: formString(fd, "verificationMode") as "NONE" | "ANY_COURSE" | "REQUIRED_COURSE" | "PATHWAY", requiredCourseId: formString(fd, "requiredCourseId"), requiredPathwayId: formString(fd, "requiredPathwayId"), minAssessmentScore: formString(fd, "minAssessmentScore") || "80" });
    revalidatePath("/staff/academy/skills");
    revalidatePath("/profile", "layout");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function savePathwayAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const courseIds = formList(fd, "courseIds");
    await savePathway(prisma, actor, { id: formString(fd, "id"), title: formString(fd, "title"), description: formString(fd, "description"), isActive: fd.get("isActive") === "on", courses: courseIds.map((courseId) => ({ courseId, isRequired: fd.get(`required:${courseId}`) === "on" })) });
    revalidatePath("/staff/academy/skills");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function requestSkillTagAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await requestSkillTag(prisma, actor, formString(fd, "text"));
    revalidatePath("/profile/skills");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function decideTagRequestAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await decideTagRequest(prisma, actor, { requestId: formString(fd, "requestId"), decision: formString(fd, "decision") as "APPROVE" | "MERGE" | "REJECT", category: formString(fd, "category"), mergeIntoSkillId: formString(fd, "mergeIntoSkillId"), note: formString(fd, "note") });
    revalidatePath("/staff/academy/skills");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function setCourseSkillTagsAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const courseId = formString(fd, "courseId");
    await setCourseSkillTags(prisma, actor, courseId, formList(fd, "skillIds"));
    revalidatePath(`/courses/manage/${courseId}`, "layout");
    revalidatePath("/staff/academy/skills");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function setOpportunityRequirementsAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const opportunityId = formString(fd, "opportunityId");
    const items: Array<{ skillId: string; certificationTemplateId: string; requiredLevel: "DECLARED" | "VERIFIED" | "CERTIFIED" }> = [];
    for (const skillId of formList(fd, "skillIds")) {
      const level = formString(fd, `level:${skillId}`) as "DECLARED" | "VERIFIED" | "";
      if (level) items.push({ skillId, certificationTemplateId: "", requiredLevel: level });
    }
    for (const certificationTemplateId of formList(fd, "certificationTemplateIds")) items.push({ skillId: "", certificationTemplateId, requiredLevel: "CERTIFIED" });
    await setOpportunityRequirements(prisma, actor, { opportunityId, items });
    revalidatePath(`/staff/opportunities/${opportunityId}`);
    revalidatePath("/agency/opportunities");
    revalidatePath("/opportunities", "layout");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}
