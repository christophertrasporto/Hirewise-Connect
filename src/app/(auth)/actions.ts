"use server";

import { registerViaInvite } from "@/server/services/invite.service";
import { redirect } from "next/navigation";
import { applicantRegistrationSchema, registerApplicant } from "@/server/services/agency-application.service";
import { prisma } from "@/server/db/client";
import { readSessionCookie, writeSessionCookie, clearSessionCookie, requestMeta } from "@/server/auth/cookies";
import { HOME_PATH } from "@/server/auth/require-actor";
import { loginWithPassword, logout, requestMagicLink, requestPasswordReset, resetPassword } from "@/server/services/auth.service";
import { registerClient, clientRegistrationSchema } from "@/server/services/client.service";
import { registerAgent, agentRegistrationSchema } from "@/server/services/agent.service";
import { toActionError, formList, formString, type ActionResult } from "@/server/http/action-result";

export async function loginAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const meta = await requestMeta();
    const s = await loginWithPassword(prisma, { email: formString(fd, "email"), password: formString(fd, "password"), remember: fd.get("remember") === "on", ...meta });
    await writeSessionCookie(s.token, s.expiresAt);
  } catch (e) {
    return toActionError(e);
  }
  redirect(HOME_PATH);
}

export async function magicLinkAction(_prev: ActionResult<{ devUrl?: string }>, fd: FormData): Promise<ActionResult<{ devUrl?: string }>> {
  try {
    const meta = await requestMeta();
    const r = await requestMagicLink(prisma, { email: formString(fd, "email"), ...meta });
    return { ok: true, data: { devUrl: r.devUrl } };
  } catch (e) {
    return toActionError(e);
  }
}

export async function forgotPasswordAction(_prev: ActionResult<{ devUrl?: string }>, fd: FormData): Promise<ActionResult<{ devUrl?: string }>> {
  try {
    const meta = await requestMeta();
    const r = await requestPasswordReset(prisma, { email: formString(fd, "email"), ...meta });
    return { ok: true, data: { devUrl: r.devUrl } };
  } catch (e) {
    return toActionError(e);
  }
}

export async function resetPasswordAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const password = formString(fd, "password");
    if (password !== formString(fd, "confirm")) return { ok: false, error: "Passwords do not match.", fieldErrors: { confirm: "Passwords do not match." } };
    await resetPassword(prisma, { token: formString(fd, "token"), password });
  } catch (e) {
    return toActionError(e);
  }
  redirect("/login?reset=1");
}

export async function logoutAction(): Promise<void> {
  await logout(prisma, await readSessionCookie());
  await clearSessionCookie();
  redirect("/login");
}

export async function registerClientAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const input = clientRegistrationSchema.parse({
      companyName: formString(fd, "companyName"),
      contactName: formString(fd, "contactName"),
      position: formString(fd, "position"),
      email: formString(fd, "email"),
      password: formString(fd, "password"),
      phone: formString(fd, "phone"),
      industry: formString(fd, "industry"),
      website: formString(fd, "website"),
      country: formString(fd, "country"),
      timezone: formString(fd, "timezone"),
      servicesNeeded: formList(fd, "servicesNeeded"),
      agentsRequired: formString(fd, "agentsRequired") || "1",
      preferredSchedule: formString(fd, "preferredSchedule"),
      expectedStartDate: formString(fd, "expectedStartDate"),
      notes: formString(fd, "notes"),
      termsAccepted: fd.get("termsAccepted") === "on",
    });
    const meta = await requestMeta();
    const s = await registerClient(prisma, input, meta);
    await writeSessionCookie(s.token, s.expiresAt);
  } catch (e) {
    return toActionError(e);
  }
  redirect(HOME_PATH);
}

/** Agency A1: sign-up for people who want to run an agency and are neither talent nor clients (APPLICANT role). */
export async function registerApplicantAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const input = applicantRegistrationSchema.parse({ fullName: formString(fd, "fullName"), email: formString(fd, "email"), password: formString(fd, "password"), termsAccepted: fd.get("termsAccepted") === "on", continuationToken: formString(fd, "continuationToken") });
    const meta = await requestMeta();
    const s = await registerApplicant(prisma, input, meta);
    await writeSessionCookie(s.token, s.expiresAt);
  } catch (e) {
    return toActionError(e);
  }
  redirect("/apply/agency");
}

export async function registerAgentAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const input = agentRegistrationSchema.parse({
      fullName: formString(fd, "fullName"),
      displayName: formString(fd, "displayName"),
      email: formString(fd, "email"),
      password: formString(fd, "password"),
      phone: formString(fd, "phone"),
      locationCity: formString(fd, "locationCity"),
      locationCountry: formString(fd, "locationCountry"),
      timezone: formString(fd, "timezone"),
      primaryRole: formString(fd, "primaryRole"),
      yearsExperience: formString(fd, "yearsExperience") || "0",
      termsAccepted: fd.get("termsAccepted") === "on",
      continuationToken: formString(fd, "continuationToken"),
    });
    const meta = await requestMeta();
    const inviteToken = formString(fd, "inviteToken");
    const s = inviteToken ? await registerViaInvite(prisma, input, inviteToken, meta) : await registerAgent(prisma, input, meta);
    await writeSessionCookie(s.token, s.expiresAt);
  } catch (e) {
    return toActionError(e);
  }
  redirect(HOME_PATH);
}
