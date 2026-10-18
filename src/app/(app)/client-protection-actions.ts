"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { toActionError, formString, type ActionResult } from "@/server/http/action-result";
import { updatePartnerIdentity } from "@/server/services/partner.service";
import { grantDisclosure, revokeDisclosure } from "@/server/services/disclosure.service";
import { reviewClientSafeDocument, clientSafeDocumentUrl } from "@/server/services/client-safe-document.service";
import { setClientLabel } from "@/server/services/agent.service";

export async function updatePartnerIdentityAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const agencyId = formString(fd, "agencyId");
    await updatePartnerIdentity(prisma, actor, agencyId, { clientFacingName: formString(fd, "clientFacingName"), specializations: formString(fd, "specializations") });
    revalidatePath(`/staff/agencies/${agencyId}`);
    revalidatePath("/partners", "layout");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function grantDisclosureAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await grantDisclosure(prisma, actor, { scope: formString(fd, "scope") as "AGENT_IDENTITY" | "AGENCY_IDENTITY" | "CLIENT_IDENTITY", clientId: formString(fd, "clientId"), agentProfileId: formString(fd, "agentProfileId"), agencyId: formString(fd, "agencyId"), reason: formString(fd, "reason") });
    revalidatePath("/staff", "layout");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function revokeDisclosureAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await revokeDisclosure(prisma, actor, formString(fd, "grantId"), formString(fd, "reason"));
    revalidatePath("/staff", "layout");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function reviewClientSafeDocumentAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await reviewClientSafeDocument(prisma, actor, { id: formString(fd, "id"), decision: formString(fd, "decision") as "APPROVE" | "REJECT" | "REGENERATE", note: formString(fd, "note") });
    revalidatePath("/staff/media");
    revalidatePath("/staff/talent", "layout");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function setClientLabelAction(_prev: ActionResult<{ label: string }>, fd: FormData): Promise<ActionResult<{ label: string }>> {
  try {
    const actor = await requireActor();
    const agentProfileId = formString(fd, "agentProfileId");
    const label = await setClientLabel(prisma, actor, agentProfileId, formString(fd, "label") || null);
    revalidatePath(`/staff/talent/${agentProfileId}`);
    return { ok: true, data: { label } };
  } catch (e) {
    return toActionError(e);
  }
}

export async function clientSafeDocumentUrlAction(id: string): Promise<ActionResult<{ url: string }>> {
  try {
    const actor = await requireActor();
    return { ok: true, data: { url: await clientSafeDocumentUrl(prisma, actor, id) } };
  } catch (e) {
    return toActionError(e);
  }
}
