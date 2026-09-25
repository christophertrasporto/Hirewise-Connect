"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { toActionError, formString, type ActionResult } from "@/server/http/action-result";
import { inviteStaffUser, resendStaffInvite, changeUserRole, grantPermissionOverride, revokePermissionOverride, inviteStaffSchema, changeRoleSchema, grantOverrideSchema } from "@/server/services/user-admin.service";
import { suspendUser, reinstateUser } from "@/server/services/incident.service";

const done = () => revalidatePath("/staff/users");

export async function inviteStaffAction(_prev: ActionResult<{ devUrl?: string }>, fd: FormData): Promise<ActionResult<{ devUrl?: string }>> {
  try {
    const actor = await requireActor();
    const r = await inviteStaffUser(prisma, actor, inviteStaffSchema.parse({ email: formString(fd, "email"), role: formString(fd, "role"), reason: formString(fd, "reason") }));
    done();
    return { ok: true, data: { devUrl: r.devUrl } };
  } catch (e) {
    return toActionError(e);
  }
}

export async function resendInviteAction(_prev: ActionResult<{ devUrl?: string }>, fd: FormData): Promise<ActionResult<{ devUrl?: string }>> {
  try {
    const actor = await requireActor();
    const r = await resendStaffInvite(prisma, actor, formString(fd, "userId"));
    return { ok: true, data: { devUrl: r.devUrl } };
  } catch (e) {
    return toActionError(e);
  }
}

export async function changeRoleAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await changeUserRole(prisma, actor, changeRoleSchema.parse({ userId: formString(fd, "userId"), role: formString(fd, "role"), reason: formString(fd, "reason") }));
    done();
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function grantOverrideAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await grantPermissionOverride(prisma, actor, grantOverrideSchema.parse({ userId: formString(fd, "userId"), permission: formString(fd, "permission"), reason: formString(fd, "reason"), expiresAt: formString(fd, "expiresAt") }));
    done();
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function revokeOverrideAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await revokePermissionOverride(prisma, actor, formString(fd, "overrideId"), formString(fd, "reason"));
    done();
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function userStatusAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const userId = formString(fd, "userId");
    const op = formString(fd, "op");
    if (op === "SUSPEND") await suspendUser(prisma, actor, userId, formString(fd, "reason"));
    else if (op === "REINSTATE") await reinstateUser(prisma, actor, userId, formString(fd, "reason"));
    else return { ok: false, error: "Unknown operation." };
    revalidatePath("/staff", "layout");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}
