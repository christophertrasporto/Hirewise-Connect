"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { toActionError, formString, type ActionResult } from "@/server/http/action-result";
import { questionSchema, saveQuestion, deleteQuestion, moveQuestion, duplicateQuestion, startAttempt, submitAttempt, reviewAttempt, reviewSchema, type AnswerMap } from "@/server/services/quiz.service";

function revalidateLesson(courseId: string, lessonId: string) {
  revalidatePath(`/courses/manage/${courseId}/lessons/${lessonId}`);
  revalidatePath(`/courses/manage/${courseId}`, "layout");
  revalidatePath(`/courses/${courseId}`, "layout");
}

/** The Question Builder posts one question at a time; choices arrive as a JSON array built client-side. */
export async function saveQuestionAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const courseId = formString(fd, "courseId");
    const lessonId = formString(fd, "lessonId");
    let choices: unknown = [];
    try {
      choices = JSON.parse(formString(fd, "choices") || "[]");
    } catch {
      return { ok: false, error: "The choices could not be read. Reload and try again." };
    }
    const input = questionSchema.parse({
      id: formString(fd, "id") || undefined,
      type: formString(fd, "type") || "MULTIPLE_CHOICE",
      prompt: formString(fd, "prompt"),
      explanation: formString(fd, "explanation"),
      points: formString(fd, "points") || "1",
      isRequired: fd.getAll("isRequired").includes("on"),
      state: formString(fd, "state") || "PUBLISHED",
      keywords: formString(fd, "keywords").split(",").map((k) => k.trim()).filter(Boolean),
      topic: formString(fd, "topic"),
      difficulty: formString(fd, "difficulty"),
      choices,
    });
    await saveQuestion(prisma, actor, courseId, lessonId, input);
    revalidateLesson(courseId, lessonId);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteQuestionAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const courseId = formString(fd, "courseId");
    await deleteQuestion(prisma, actor, courseId, formString(fd, "questionId"));
    revalidateLesson(courseId, formString(fd, "lessonId"));
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function moveQuestionAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const courseId = formString(fd, "courseId");
    await moveQuestion(prisma, actor, courseId, formString(fd, "questionId"), formString(fd, "direction") === "up" ? -1 : 1);
    revalidateLesson(courseId, formString(fd, "lessonId"));
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function duplicateQuestionAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const courseId = formString(fd, "courseId");
    await duplicateQuestion(prisma, actor, courseId, formString(fd, "questionId"));
    revalidateLesson(courseId, formString(fd, "lessonId"));
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function reviewAttemptAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const courseId = formString(fd, "courseId");
    await reviewAttempt(prisma, actor, courseId, formString(fd, "attemptId"), reviewSchema.parse({ scorePercent: formString(fd, "scorePercent"), feedback: formString(fd, "feedback") }));
    revalidatePath(`/courses/manage/${courseId}`, "layout");
    revalidatePath("/courses", "layout");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

// ---------------------------------------------------------------------------
// Learner
// ---------------------------------------------------------------------------

export async function startAttemptAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  let attemptId: string;
  try {
    const actor = await requireActor();
    attemptId = await startAttempt(prisma, actor, formString(fd, "lessonId"));
  } catch (e) {
    return toActionError(e);
  }
  redirect(`/courses/attempt/${attemptId}`);
}

export type SubmitResult = { scorePercent: number; passed: boolean | null; expired: boolean; pendingReview: boolean; attemptsLeft: number | null; courseCompleted: boolean; coursePercent: number };

/** Answers arrive as q:<questionId> fields: one or many choice ids, or a text answer. */
export async function submitAttemptAction(_prev: ActionResult<SubmitResult>, fd: FormData): Promise<ActionResult<SubmitResult>> {
  try {
    const actor = await requireActor();
    const attemptId = formString(fd, "attemptId");
    const answers: AnswerMap = {};
    for (const [k, v] of fd.entries()) {
      if (!k.startsWith("q:") || typeof v !== "string" || v === "") continue;
      const id = k.slice(2);
      if (k.endsWith(":text")) {
        answers[id.replace(/:text$/, "")] = v;
      } else {
        const prev = answers[id];
        answers[id] = Array.isArray(prev) ? [...prev, v] : [v];
      }
    }
    const r = await submitAttempt(prisma, actor, attemptId, answers);
    revalidatePath("/courses", "layout");
    revalidatePath("/dashboard");
    return { ok: true, data: r };
  } catch (e) {
    return toActionError(e);
  }
}
