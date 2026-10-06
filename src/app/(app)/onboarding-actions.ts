"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { toActionError, formString, type ActionResult } from "@/server/http/action-result";
import { createWelcomeVideoUploadUrl, updateWelcomeVideoConfig, welcomeVideoConfigSchema } from "@/server/services/onboarding.service";

export async function saveWelcomeVideoConfigAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const input = welcomeVideoConfigSchema.parse({
      enabled: fd.get("enabled") === "on",
      title: formString(fd, "title"),
      instructions: formString(fd, "instructions"),
      videoUrl: formString(fd, "videoUrl"),
      storageKey: formString(fd, "storageKey"),
      fileName: formString(fd, "fileName"),
      durationSec: formString(fd, "durationSec"),
      requiredPercent: formString(fd, "requiredPercent") || "90",
      lockCourses: fd.get("lockCourses") === "on",
      appliesTo: formString(fd, "appliesTo") || "NEW",
    });
    await updateWelcomeVideoConfig(prisma, actor, input);
    revalidatePath("/staff/academy/onboarding");
    revalidatePath("/dashboard");
    revalidatePath("/courses");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function requestWelcomeVideoUploadAction(input: { contentType: string; sizeBytes: number }): Promise<ActionResult<{ key: string; url: string; method: "PUT"; headers: Record<string, string> }>> {
  try {
    const actor = await requireActor();
    return { ok: true, data: await createWelcomeVideoUploadUrl(prisma, actor, input) };
  } catch (e) {
    return toActionError(e);
  }
}
