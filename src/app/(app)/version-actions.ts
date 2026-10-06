"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { toActionError, formString, type ActionResult } from "@/server/http/action-result";
import { restoreLessonVersion } from "@/server/services/lesson-version.service";

export async function restoreLessonVersionAction(_prev: ActionResult<{ version: number }>, fd: FormData): Promise<ActionResult<{ version: number }>> {
  try {
    const actor = await requireActor();
    const courseId = formString(fd, "courseId");
    const lessonId = formString(fd, "lessonId");
    const version = await restoreLessonVersion(prisma, actor, courseId, lessonId, Number(formString(fd, "version")));
    revalidatePath(`/courses/manage/${courseId}/lessons/${lessonId}`);
    revalidatePath(`/courses/manage/${courseId}`, "layout");
    revalidatePath(`/courses/${courseId}`, "layout");
    return { ok: true, data: { version } };
  } catch (e) {
    return toActionError(e);
  }
}
