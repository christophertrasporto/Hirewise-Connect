"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { toActionError, formList, formString, type ActionResult } from "@/server/http/action-result";
import { searchFiltersSchema } from "@/server/services/search.service";
import { saveSearch, deleteSavedSearch, touchSavedSearch } from "@/server/services/saved-search.service";
import { incidentSchema, createIncident, transitionIncident, suspendUser, reinstateUser, evidenceUploadUrl, attachEvidence, evidenceDownloadUrl } from "@/server/services/incident.service";
import { bulkAgentSchema, bulkAgentAction, broadcastSchema, broadcastNotification, anonymiseUser, runRetention } from "@/server/services/admin.service";
import { createCheckout } from "@/server/services/billing.service";

// --- Saved searches ----------------------------------------------------------

export async function saveSearchAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    let filters: unknown = {};
    try {
      filters = JSON.parse(formString(fd, "filters") || "{}");
    } catch {
      return { ok: false, error: "Could not read the current filters." };
    }
    await saveSearch(prisma, actor, formString(fd, "name"), searchFiltersSchema.parse(filters));
    revalidatePath("/talent");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteSavedSearchAction(fd: FormData): Promise<void> {
  const actor = await requireActor();
  await deleteSavedSearch(prisma, actor, formString(fd, "id"));
  revalidatePath("/talent");
}

export async function runSavedSearchAction(fd: FormData): Promise<void> {
  const actor = await requireActor();
  const id = formString(fd, "id");
  await touchSavedSearch(prisma, actor, id);
  redirect(`/talent?${formString(fd, "query")}`);
}

// --- Incidents -----------------------------------------------------------------

export async function createIncidentAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  let id: string;
  try {
    const actor = await requireActor();
    id = await createIncident(prisma, actor, incidentSchema.parse({ subjectUserId: formString(fd, "subjectUserId"), type: formString(fd, "type"), severity: formString(fd, "severity") || "MEDIUM", description: formString(fd, "description"), relatedType: formString(fd, "relatedType"), relatedId: formString(fd, "relatedId") }));
    revalidatePath("/staff/compliance", "layout");
  } catch (e) {
    return toActionError(e);
  }
  redirect(`/staff/compliance/incidents/${id}`);
}

export async function incidentWorkflowAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const id = formString(fd, "incidentId");
    const op = formString(fd, "op");
    if (op === "UNDER_REVIEW" || op === "RESOLVED" || op === "DISMISSED") await transitionIncident(prisma, actor, id, op, formString(fd, "resolution") || undefined);
    else if (op === "SUSPEND") await suspendUser(prisma, actor, formString(fd, "userId"), formString(fd, "reason"), id || undefined);
    else if (op === "REINSTATE") await reinstateUser(prisma, actor, formString(fd, "userId"), formString(fd, "reason"));
    else if (op === "ATTACH") await attachEvidence(prisma, actor, id, formString(fd, "storageKey"));
    else return { ok: false, error: "Unknown operation." };
    revalidatePath("/staff/compliance", "layout");
    revalidatePath("/staff/talent", "layout");
    revalidatePath("/staff/users");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function evidenceUploadUrlAction(incidentId: string, contentType: string): Promise<ActionResult<{ key: string; url: string; method: "PUT"; headers: Record<string, string> }>> {
  try {
    const actor = await requireActor();
    return { ok: true, data: await evidenceUploadUrl(prisma, actor, incidentId, contentType) };
  } catch (e) {
    return toActionError(e);
  }
}

export async function evidenceUrlAction(incidentId: string, documentId: string): Promise<ActionResult<{ url: string }>> {
  try {
    const actor = await requireActor();
    return { ok: true, data: { url: await evidenceDownloadUrl(prisma, actor, incidentId, documentId) } };
  } catch (e) {
    return toActionError(e);
  }
}

// --- Bulk admin, broadcast, data protection --------------------------------------

export async function bulkAgentActionAction(_prev: ActionResult<{ done: number; failed: Array<{ id: string; error: string }> }>, fd: FormData): Promise<ActionResult<{ done: number; failed: Array<{ id: string; error: string }> }>> {
  try {
    const actor = await requireActor();
    const input = bulkAgentSchema.parse({ agentProfileIds: formList(fd, "agentProfileIds"), op: formString(fd, "op"), availability: formString(fd, "availability") || undefined, level: formString(fd, "level") || undefined, title: formString(fd, "title"), body: formString(fd, "body"), reason: formString(fd, "reason") });
    const result = await bulkAgentAction(prisma, actor, input);
    revalidatePath("/staff/talent", "layout");
    revalidatePath("/talent", "layout");
    return { ok: true, data: result };
  } catch (e) {
    return toActionError(e);
  }
}

export async function broadcastAction(_prev: ActionResult<{ recipients: number }>, fd: FormData): Promise<ActionResult<{ recipients: number }>> {
  try {
    const actor = await requireActor();
    const recipients = await broadcastNotification(prisma, actor, broadcastSchema.parse({ roles: formList(fd, "roles"), title: formString(fd, "title"), body: formString(fd, "body"), email: fd.get("email") === "on" }));
    return { ok: true, data: { recipients } };
  } catch (e) {
    return toActionError(e);
  }
}

export async function anonymiseUserAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await anonymiseUser(prisma, actor, formString(fd, "userId"), formString(fd, "reason"));
    revalidatePath("/staff", "layout");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function runRetentionAction(_prev: ActionResult<{ considered: number; done: number; failed: Array<{ id: string; error: string }> }>): Promise<ActionResult<{ considered: number; done: number; failed: Array<{ id: string; error: string }> }>> {
  try {
    const actor = await requireActor();
    const r = await runRetention(prisma, actor);
    revalidatePath("/staff", "layout");
    return { ok: true, data: r };
  } catch (e) {
    return toActionError(e);
  }
}

// --- Online payment ---------------------------------------------------------------

export async function checkoutAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  let url: string | null = null;
  try {
    const actor = await requireActor();
    const r = await createCheckout(prisma, actor, formString(fd, "invoiceId"));
    if (!r) return { ok: false, error: "Online payment is not available. Use the bank transfer instructions." };
    url = r.url;
  } catch (e) {
    return toActionError(e);
  }
  redirect(url);
}
