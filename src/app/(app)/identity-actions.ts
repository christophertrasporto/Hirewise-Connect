"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { requestMeta } from "@/server/auth/cookies";
import { decideDuplicateFlag } from "@/server/services/identity.service";
import { publishTermsVersion, publishTermsSchema } from "@/server/services/terms.service";
import { toActionError, formString, formList, type ActionResult } from "@/server/http/action-result";

/** Identity phase 1: Admin decides a duplicate flag. */
export async function decideDuplicateFlagAction(_prev: ActionResult<{ status: string }>, fd: FormData): Promise<ActionResult<{ status: string }>> {
  try {
    const actor = await requireActor();
    const decision = formString(fd, "decision");
    if (decision !== "APPROVED_NEW_PROFILE" && decision !== "LINKED" && decision !== "REJECTED") return { ok: false, error: "Choose a decision." };
    const r = await decideDuplicateFlag(prisma, actor, formString(fd, "flagId"), decision, formString(fd, "note") || null, await requestMeta());
    revalidatePath("/staff/identity");
    return { ok: true, data: { status: r.status } };
  } catch (e) {
    return toActionError(e);
  }
}

/** Identity phase 1: publish a new version of the unified terms or the privacy policy from the section editor. */
export async function publishTermsAction(_prev: ActionResult<{ version: number; placeholder: boolean }>, fd: FormData): Promise<ActionResult<{ version: number; placeholder: boolean }>> {
  try {
    const actor = await requireActor();
    const count = Number(formString(fd, "sectionCount") || "0");
    const sections = [];
    for (let i = 0; i < count; i += 1) {
      const title = formString(fd, `section.${i}.title`);
      const body = formString(fd, `section.${i}.body`);
      if (!title && !body) continue;
      sections.push({ key: formString(fd, `section.${i}.key`) || `section-${i + 1}`, title, audiences: formList(fd, `section.${i}.audiences`), bodyMarkdown: body });
    }
    const input = publishTermsSchema.parse({
      type: formString(fd, "type"),
      title: formString(fd, "title"),
      sections,
      effectiveFrom: formString(fd, "effectiveFrom"),
      isMaterialChange: fd.get("isMaterialChange") === "on",
      requiresReacceptance: fd.get("requiresReacceptance") === "on",
      privacyPolicyMode: formString(fd, "privacyPolicyMode") || "COMBINED",
      changeNote: formString(fd, "changeNote"),
    });
    const r = await publishTermsVersion(prisma, actor, input);
    revalidatePath("/staff/agreements");
    revalidatePath("/terms");
    revalidatePath("/privacy");
    return { ok: true, data: { version: r.version, placeholder: r.placeholder } };
  } catch (e) {
    return toActionError(e);
  }
}
