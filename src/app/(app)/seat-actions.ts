"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { requestMeta } from "@/server/auth/cookies";
import { requestSeats, purchasePackage, adminChangeSeats, assignPlan, decideSeatRequest, recordSeatPurchase, savePlan, savePackage } from "@/server/services/seat.service";
import { rotateInviteLink, sendEmailInvites, revokeEmailInvite, joinAsExistingUser } from "@/server/services/invite.service";
import { toActionError, formString, type ActionResult } from "@/server/http/action-result";

const revalidateAgency = () => {
  revalidatePath("/agency");
  revalidatePath("/agency/team");
  revalidatePath("/agency/settings");
};

// ---------------------------------------------------------------- owner / manager

export async function requestSeatsAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await requestSeats(prisma, actor, { requestedSeats: formString(fd, "requestedSeats"), note: formString(fd, "note") });
    revalidateAgency();
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function purchasePackageAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await purchasePackage(prisma, actor, formString(fd, "packageId"), formString(fd, "note"));
    revalidateAgency();
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function rotateInviteLinkAction(_prev: ActionResult<{ url: string }>, _fd: FormData): Promise<ActionResult<{ url: string }>> {
  try {
    const actor = await requireActor();
    const link = await rotateInviteLink(prisma, actor);
    revalidateAgency();
    return { ok: true, data: { url: link.url } };
  } catch (e) {
    return toActionError(e);
  }
}

export async function sendEmailInvitesAction(_prev: ActionResult<{ sent: string[]; skipped: Array<{ email: string; reason: string }> }>, fd: FormData): Promise<ActionResult<{ sent: string[]; skipped: Array<{ email: string; reason: string }> }>> {
  try {
    const actor = await requireActor();
    const emails = formString(fd, "emails").split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean);
    const r = await sendEmailInvites(prisma, actor, { emails });
    revalidateAgency();
    return { ok: true, data: r };
  } catch (e) {
    return toActionError(e);
  }
}

export async function revokeEmailInviteAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await revokeEmailInvite(prisma, actor, formString(fd, "inviteId"));
    revalidateAgency();
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

/** A signed-in talent account joins from the invitation page. */
export async function joinAgencyAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await joinAsExistingUser(prisma, actor, formString(fd, "token"), await requestMeta());
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

// ---------------------------------------------------------------- Hirewise admin

export async function adminSeatChangeAction(_prev: ActionResult<{ total: number; available: number }>, fd: FormData): Promise<ActionResult<{ total: number; available: number }>> {
  try {
    const actor = await requireActor();
    const totals = await adminChangeSeats(prisma, actor, { agencyId: formString(fd, "agencyId"), changeType: formString(fd, "changeType") as "ADMIN_ADD", quantity: formString(fd, "quantity"), reason: formString(fd, "reason"), override: fd.get("override") === "on" });
    revalidatePath(`/staff/agencies/${formString(fd, "agencyId")}`);
    return { ok: true, data: { total: totals.total, available: totals.available } };
  } catch (e) {
    return toActionError(e);
  }
}

export async function assignPlanAction(_prev: ActionResult<{ total: number; available: number }>, fd: FormData): Promise<ActionResult<{ total: number; available: number }>> {
  try {
    const actor = await requireActor();
    const agencyId = formString(fd, "agencyId");
    const totals = await assignPlan(prisma, actor, agencyId, formString(fd, "planKey") || null, formString(fd, "reason"), fd.get("override") === "on");
    revalidatePath(`/staff/agencies/${agencyId}`);
    return { ok: true, data: { total: totals.total, available: totals.available } };
  } catch (e) {
    return toActionError(e);
  }
}

export async function decideSeatRequestAction(_prev: ActionResult<{ status: string }>, fd: FormData): Promise<ActionResult<{ status: string }>> {
  try {
    const actor = await requireActor();
    const r = await decideSeatRequest(prisma, actor, formString(fd, "requestId"), { decision: formString(fd, "decision") as "APPROVE" | "REJECT", grantedSeats: formString(fd, "grantedSeats") || undefined, note: formString(fd, "note") });
    revalidatePath("/staff/agencies/seats");
    return { ok: true, data: { status: r.status } };
  } catch (e) {
    return toActionError(e);
  }
}

export async function recordSeatPurchaseAction(_prev: ActionResult<{ status: string }>, fd: FormData): Promise<ActionResult<{ status: string }>> {
  try {
    const actor = await requireActor();
    const r = await recordSeatPurchase(prisma, actor, formString(fd, "purchaseId"), { outcome: formString(fd, "outcome") as "PAID" | "WAIVED" | "CANCELLED", reference: formString(fd, "reference"), note: formString(fd, "note") });
    revalidatePath("/staff/agencies/seats");
    return { ok: true, data: { status: r.status } };
  } catch (e) {
    return toActionError(e);
  }
}

export async function savePlanAction(_prev: ActionResult<{ key: string }>, fd: FormData): Promise<ActionResult<{ key: string }>> {
  try {
    const actor = await requireActor();
    const base = formString(fd, "baseAgentSeats");
    const p = await savePlan(prisma, actor, {
      key: formString(fd, "key").toUpperCase(),
      name: formString(fd, "name"),
      baseAgentSeats: base === "" ? null : Number(base),
      priceMinor: Math.round(Number(formString(fd, "price") || "0") * 100),
      currency: formString(fd, "currency") || "USD",
      billingPeriod: (formString(fd, "billingPeriod") || "MONTHLY") as "MONTHLY" | "ANNUAL",
      trainingAccess: fd.get("trainingAccess") === "on",
      opportunityAccess: fd.get("opportunityAccess") === "on",
      features: formString(fd, "features").split("\n").map((f) => f.trim()).filter(Boolean),
      isActive: fd.get("isActive") === "on",
      sortOrder: formString(fd, "sortOrder") || "0",
    });
    revalidatePath("/staff/agencies/plans");
    return { ok: true, data: { key: p.key } };
  } catch (e) {
    return toActionError(e);
  }
}

export async function savePackageAction(_prev: ActionResult<{ id: string }>, fd: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const p = await savePackage(prisma, actor, { id: formString(fd, "id"), name: formString(fd, "name"), seatCount: formString(fd, "seatCount"), priceMinor: Math.round(Number(formString(fd, "price") || "0") * 100), currency: formString(fd, "currency") || "USD", isActive: fd.get("isActive") === "on", sortOrder: formString(fd, "sortOrder") || "0" });
    revalidatePath("/staff/agencies/plans");
    return { ok: true, data: { id: p.id } };
  } catch (e) {
    return toActionError(e);
  }
}

