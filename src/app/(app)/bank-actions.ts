"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { toActionError, formString, type ActionResult } from "@/server/http/action-result";
import { questionSchema, deleteQuestion } from "@/server/services/quiz.service";
import { saveBankQuestion, copyQuestionToLesson, copyQuestionToBank } from "@/server/services/question-bank.service";

function revalidate(courseId: string, lessonId?: string) {
  revalidatePath(`/courses/manage/${courseId}/questions`);
  revalidatePath(`/courses/manage/${courseId}`, "layout");
  if (lessonId) revalidatePath(`/courses/manage/${courseId}/lessons/${lessonId}`);
  revalidatePath(`/courses/${courseId}`, "layout");
}

export async function saveBankQuestionAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const courseId = formString(fd, "courseId");
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
    await saveBankQuestion(prisma, actor, courseId, input);
    revalidate(courseId);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function copyToLessonAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const courseId = formString(fd, "courseId");
    const lessonId = formString(fd, "lessonId");
    if (!lessonId) return { ok: false, error: "Pick a lesson first." };
    await copyQuestionToLesson(prisma, actor, courseId, formString(fd, "questionId"), lessonId);
    revalidate(courseId, lessonId);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function copyToBankAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const courseId = formString(fd, "courseId");
    await copyQuestionToBank(prisma, actor, courseId, formString(fd, "questionId"));
    revalidate(courseId, formString(fd, "lessonId") || undefined);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteBankQuestionAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const courseId = formString(fd, "courseId");
    await deleteQuestion(prisma, actor, courseId, formString(fd, "questionId"));
    revalidate(courseId, formString(fd, "lessonId") || undefined);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}
