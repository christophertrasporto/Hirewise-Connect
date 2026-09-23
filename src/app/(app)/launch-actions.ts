"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { toActionError, formString, type ActionResult } from "@/server/http/action-result";
import { agreementVersionSchema, publishAgreementVersion, updateSetting } from "@/server/services/launch.service";

export async function publishAgreementAction(_prev: ActionResult<{ version: number }>, fd: FormData): Promise<ActionResult<{ version: number }>> {
  try {
    const actor = await requireActor();
    const input = agreementVersionSchema.parse({ type: formString(fd, "type"), title: formString(fd, "title"), bodyMarkdown: formString(fd, "bodyMarkdown"), effectiveFrom: formString(fd, "effectiveFrom"), changeNote: formString(fd, "changeNote") });
    const r = await publishAgreementVersion(prisma, actor, input);
    revalidatePath("/staff/agreements");
    revalidatePath("/staff/launch");
    revalidatePath("/legal", "layout");
    revalidatePath("/agreements");
    return { ok: true, data: { version: r.version } };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateSettingAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await updateSetting(prisma, actor, formString(fd, "key"), formString(fd, "value"), formString(fd, "reason") || undefined);
    revalidatePath("/staff/settings");
    revalidatePath("/staff/launch");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}
