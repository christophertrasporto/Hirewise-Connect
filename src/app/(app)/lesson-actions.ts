"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { toActionError, formString, type ActionResult } from "@/server/http/action-result";
import { markLessonComplete, startLesson } from "@/server/services/lesson-media.service";
import { createSubmissionUploadUrl, submitAssignment, reviewSubmission, reviewSubmissionSchema, submissionUploadRequestSchema } from "@/server/services/assignment.service";

/** Text, document, link, and non-YouTube video lessons: the learner marks them done. */
export async function markLessonCompleteAction(_prev: ActionResult<{ coursePercent: number | null; courseCompleted: boolean }>, fd: FormData): Promise<ActionResult<{ coursePercent: number | null; courseCompleted: boolean }>> {
  try {
    const actor = await requireActor();
    const r = await markLessonComplete(prisma, actor, formString(fd, "lessonId"));
    revalidatePath(`/courses/${formString(fd, "courseId")}`);
    revalidatePath("/courses", "layout");
    revalidatePath("/dashboard");
    return { ok: true, data: { coursePercent: r.coursePercent, courseCompleted: r.courseCompleted } };
  } catch (e) {
    return toActionError(e);
  }
}

/** Fire-and-forget from a link or document click: records that the learner opened the lesson. */
export async function startLessonAction(lessonId: string): Promise<void> {
  try {
    const actor = await requireActor();
    await startLesson(prisma, actor, lessonId);
  } catch {
    /* opening a lesson is best-effort */
  }
}

export async function requestSubmissionUploadAction(input: { lessonId: string; contentType: string; sizeBytes: number; fileName?: string }): Promise<ActionResult<{ key: string; url: string; method: "PUT"; headers: Record<string, string> }>> {
  try {
    const actor = await requireActor();
    const r = await createSubmissionUploadUrl(prisma, actor, input.lessonId, submissionUploadRequestSchema.parse(input));
    return { ok: true, data: r };
  } catch (e) {
    return toActionError(e);
  }
}

export async function submitAssignmentAction(_prev: ActionResult<{ late: boolean }>, fd: FormData): Promise<ActionResult<{ late: boolean }>> {
  try {
    const actor = await requireActor();
    const r = await submitAssignment(prisma, actor, formString(fd, "lessonId"), { text: formString(fd, "text"), url: formString(fd, "url"), storageKey: formString(fd, "storageKey"), fileName: formString(fd, "fileName") });
    revalidatePath(`/courses/${formString(fd, "courseId")}`);
    revalidatePath("/courses", "layout");
    return { ok: true, data: { late: r.late } };
  } catch (e) {
    return toActionError(e);
  }
}

export async function reviewSubmissionAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const courseId = formString(fd, "courseId");
    await reviewSubmission(prisma, actor, courseId, formString(fd, "submissionId"), reviewSubmissionSchema.parse({ decision: formString(fd, "decision"), grade: formString(fd, "grade"), feedback: formString(fd, "feedback") }));
    revalidatePath(`/courses/manage/${courseId}`, "layout");
    revalidatePath("/courses", "layout");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}
