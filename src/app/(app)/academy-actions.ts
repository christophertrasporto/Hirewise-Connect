"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { toActionError, formList, formString, type ActionResult } from "@/server/http/action-result";
import { courseSchema, examSchema, createCourse, updateCourse, submitCourseForApproval, publishCourse, archiveCourse, saveExam, enrol, startExamAttempt, submitExamAttempt, recordCoursePayment, addCoachToCourse, moduleSchema, lessonSchema, lessonUploadRequestSchema, saveModule, deleteModule, moveModule, saveLesson, deleteLesson, moveLesson, createLessonUploadUrl } from "@/server/services/academy.service";
import { assessmentSchema, evaluationSchema, labelSchema, recordAssessment, recordEvaluation, saveLabel } from "@/server/services/assessment.service";
import { templateSchema, saveTemplate, issueCertification, reviewCertification, revokeCertification } from "@/server/services/certification.service";
import { LEVELS, rulesSchema, setVerificationManually, updateRequirement, type Level } from "@/server/services/verification.service";

function courseInput(fd: FormData) {
  return courseSchema.parse({
    title: formString(fd, "title"),
    category: formString(fd, "category"),
    description: formString(fd, "description"),
    syllabus: formString(fd, "syllabus"),
    contentUrl: formString(fd, "contentUrl"),
    priceUsd: formString(fd, "priceUsd"),
    passingScore: formString(fd, "passingScore") || "70",
    requiresCoachReview: fd.get("requiresCoachReview") === "on",
  });
}

// ---------------------------------------------------------------------------
// Coach
// ---------------------------------------------------------------------------

export async function createCourseAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  let id: string;
  try {
    const actor = await requireActor();
    id = await createCourse(prisma, actor, courseInput(fd));
    revalidatePath("/coach");
  } catch (e) {
    return toActionError(e);
  }
  redirect(`/coach/courses/${id}`);
}

export async function updateCourseAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const courseId = formString(fd, "courseId");
    await updateCourse(prisma, actor, courseId, courseInput(fd));
    revalidatePath(`/coach/courses/${courseId}`);
    revalidatePath("/coach");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

/** Exam builder posts a JSON blob of questions built client-side. */
export async function saveExamAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const courseId = formString(fd, "courseId");
    let questions: unknown = [];
    try {
      questions = JSON.parse(formString(fd, "questions") || "[]");
    } catch {
      return { ok: false, error: "The question list could not be read. Reload and try again." };
    }
    const input = examSchema.parse({ title: formString(fd, "title"), instructions: formString(fd, "instructions"), timeLimitMin: formString(fd, "timeLimitMin"), maxAttempts: formString(fd, "maxAttempts") || "2", questions });
    await saveExam(prisma, actor, courseId, input);
    revalidatePath(`/coach/courses/${courseId}`);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

// ---------------------------------------------------------------------------
// Coach: curriculum (modules and lessons), editable at any status including PUBLISHED
// ---------------------------------------------------------------------------

function revalidateCourse(courseId: string) {
  revalidatePath(`/coach/courses/${courseId}`);
  revalidatePath(`/courses/${courseId}`);
  revalidatePath("/courses");
}

export async function saveModuleAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const courseId = formString(fd, "courseId");
    await saveModule(prisma, actor, courseId, moduleSchema.parse({ id: formString(fd, "id") || undefined, title: formString(fd, "title"), description: formString(fd, "description") }));
    revalidateCourse(courseId);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteModuleAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const courseId = formString(fd, "courseId");
    await deleteModule(prisma, actor, courseId, formString(fd, "moduleId"));
    revalidateCourse(courseId);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function moveModuleAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const courseId = formString(fd, "courseId");
    await moveModule(prisma, actor, courseId, formString(fd, "moduleId"), formString(fd, "direction") === "up" ? -1 : 1);
    revalidateCourse(courseId);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function saveLessonAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const courseId = formString(fd, "courseId");
    const input = lessonSchema.parse({
      id: formString(fd, "id") || undefined,
      moduleId: formString(fd, "moduleId"),
      title: formString(fd, "title"),
      contentType: formString(fd, "contentType"),
      body: formString(fd, "body"),
      url: formString(fd, "url"),
      storageKey: formString(fd, "storageKey"),
      fileName: formString(fd, "fileName"),
      contentMime: formString(fd, "contentMime"),
      sizeBytes: formString(fd, "sizeBytes"),
      durationSec: formString(fd, "durationSec"),
    });
    await saveLesson(prisma, actor, courseId, input);
    revalidateCourse(courseId);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteLessonAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const courseId = formString(fd, "courseId");
    await deleteLesson(prisma, actor, courseId, formString(fd, "lessonId"));
    revalidateCourse(courseId);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function moveLessonAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const courseId = formString(fd, "courseId");
    await moveLesson(prisma, actor, courseId, formString(fd, "lessonId"), formString(fd, "direction") === "up" ? -1 : 1);
    revalidateCourse(courseId);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

/** Presigned PUT for a lesson file. The browser uploads, then saveLessonAction records the key. */
export async function requestLessonUploadAction(input: { courseId: string; kind: string; contentType: string; sizeBytes: number; fileName?: string }): Promise<ActionResult<{ key: string; url: string; method: "PUT"; headers: Record<string, string> }>> {
  try {
    const actor = await requireActor();
    const r = await createLessonUploadUrl(prisma, actor, input.courseId, lessonUploadRequestSchema.parse(input));
    return { ok: true, data: r };
  } catch (e) {
    return toActionError(e);
  }
}

export async function courseWorkflowAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const courseId = formString(fd, "courseId");
    const op = formString(fd, "op");
    if (op === "SUBMIT") await submitCourseForApproval(prisma, actor, courseId);
    else if (op === "PUBLISH") await publishCourse(prisma, actor, courseId, { certificationTemplateId: formString(fd, "certificationTemplateId") || null });
    else if (op === "ARCHIVE") await archiveCourse(prisma, actor, courseId);
    else if (op === "ADD_COACH") await addCoachToCourse(prisma, actor, courseId, formString(fd, "coachUserId"));
    else return { ok: false, error: "Unknown operation." };
    revalidatePath(`/coach/courses/${courseId}`);
    revalidatePath("/coach");
    revalidatePath("/staff/academy");
    revalidatePath("/courses");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function recordAssessmentAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const input = assessmentSchema.parse({
      courseId: formString(fd, "courseId"),
      agentProfileId: formString(fd, "agentProfileId"),
      type: formString(fd, "type"),
      examScore: formString(fd, "examScore"),
      practicalScore: formString(fd, "practicalScore"),
      roleplayScore: formString(fd, "roleplayScore"),
      communicationScore: formString(fd, "communicationScore"),
      comments: formString(fd, "comments"),
      strengths: formString(fd, "strengths"),
      areasForImprovement: formString(fd, "areasForImprovement"),
      resultLabelId: formString(fd, "resultLabelId"),
      certificationRecommended: fd.get("certificationRecommended") === "on",
    });
    const r = await recordAssessment(prisma, actor, input);
    revalidatePath(`/coach/courses/${input.courseId}`);
    revalidatePath("/coach");
    return { ok: true, data: undefined, error: r.certification.issued ? undefined : undefined };
  } catch (e) {
    return toActionError(e);
  }
}

export async function recordEvaluationAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const input = evaluationSchema.parse({
      agentProfileId: formString(fd, "agentProfileId"),
      summary: formString(fd, "summary"),
      communication: formString(fd, "communication"),
      reliability: formString(fd, "reliability"),
      coachability: formString(fd, "coachability"),
      overallLabelId: formString(fd, "overallLabelId"),
      visibleToClients: fd.get("visibleToClients") === "on",
    });
    await recordEvaluation(prisma, actor, input);
    revalidatePath("/coach");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export async function enrolAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const courseId = formString(fd, "courseId");
    await enrol(prisma, actor, courseId);
    revalidatePath("/courses");
    revalidatePath(`/courses/${courseId}`);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function startExamAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  let attemptId: string;
  try {
    const actor = await requireActor();
    attemptId = await startExamAttempt(prisma, actor, formString(fd, "courseId"));
  } catch (e) {
    return toActionError(e);
  }
  redirect(`/courses/exam/${attemptId}`);
}

export async function submitExamAction(_prev: ActionResult<{ scorePercent: number; passed: boolean; expired: boolean }>, fd: FormData): Promise<ActionResult<{ scorePercent: number; passed: boolean; expired: boolean }>> {
  try {
    const actor = await requireActor();
    const attemptId = formString(fd, "attemptId");
    const answers: Record<string, number> = {};
    for (const [k, v] of fd.entries()) {
      if (k.startsWith("q:") && typeof v === "string" && v !== "") answers[k.slice(2)] = Number(v);
    }
    const r = await submitExamAttempt(prisma, actor, attemptId, answers);
    revalidatePath("/courses", "layout");
    revalidatePath("/dashboard");
    return { ok: true, data: { scorePercent: r.scorePercent, passed: r.passed, expired: r.expired } };
  } catch (e) {
    return toActionError(e);
  }
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export async function recordCoursePaymentAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await recordCoursePayment(prisma, actor, formString(fd, "enrollmentId"), { paidUsd: formString(fd, "paidUsd"), reference: formString(fd, "reference"), waived: fd.get("waived") === "on", reason: formString(fd, "reason") });
    revalidatePath("/staff/academy", "layout");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function certificationReviewAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const op = formString(fd, "op");
    const id = formString(fd, "certificationId");
    if (op === "APPROVE" || op === "REJECT") await reviewCertification(prisma, actor, id, op, formString(fd, "reason"));
    else if (op === "REVOKE") await revokeCertification(prisma, actor, id, formString(fd, "reason"));
    else return { ok: false, error: "Unknown operation." };
    revalidatePath("/staff/academy", "layout");
    revalidatePath("/staff/talent", "layout");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function issueCertificationAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const agentProfileId = formString(fd, "agentProfileId");
    await issueCertification(prisma, actor, { agentProfileId, templateId: formString(fd, "templateId"), reason: formString(fd, "reason") });
    revalidatePath(`/staff/talent/${agentProfileId}`);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function setVerificationAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const agentProfileId = formString(fd, "agentProfileId");
    const level = formString(fd, "level") as Level;
    if (!LEVELS.includes(level)) return { ok: false, error: "Unknown level." };
    await setVerificationManually(prisma, actor, agentProfileId, level, formString(fd, "reason"));
    revalidatePath(`/staff/talent/${agentProfileId}`);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function saveTemplateAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const input = templateSchema.parse({
      id: formString(fd, "id") || undefined,
      name: formString(fd, "name"),
      description: formString(fd, "description"),
      validityMonths: formString(fd, "validityMonths"),
      requiresCompletion: fd.get("requiresCompletion") === "on",
      minExamScore: formString(fd, "minExamScore"),
      requiresCoachReview: fd.get("requiresCoachReview") === "on",
      minResultLabelRank: formString(fd, "minResultLabelRank"),
      isActive: fd.get("isActive") === "on",
    });
    await saveTemplate(prisma, actor, input);
    revalidatePath("/staff/academy", "layout");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function saveLabelAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await saveLabel(prisma, actor, labelSchema.parse({ key: formString(fd, "key"), label: formString(fd, "label"), rank: formString(fd, "rank"), isActive: fd.get("isActive") !== "off" }));
    revalidatePath("/staff/academy", "layout");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function saveRequirementAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const level = formString(fd, "level") as Level;
    if (!LEVELS.includes(level)) return { ok: false, error: "Unknown level." };
    const num = (k: string) => (formString(fd, k) ? Number(formString(fd, k)) : undefined);
    const rules = rulesSchema.parse({
      profileApproved: fd.get("profileApproved") === "on" || undefined,
      videoApproved: fd.get("videoApproved") === "on" || undefined,
      minApprovedRecordings: num("minApprovedRecordings"),
      minApprovedCertifications: num("minApprovedCertifications"),
      minAssessmentLabelRank: num("minAssessmentLabelRank"),
      publishedBillingRate: fd.get("publishedBillingRate") === "on" || undefined,
    });
    await updateRequirement(prisma, actor, level, rules);
    revalidatePath("/staff/academy", "layout");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function noopList(fd: FormData) {
  return formList(fd, "x");
}
