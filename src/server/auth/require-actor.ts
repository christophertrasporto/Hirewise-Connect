import { cache } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db/client";
import type { Actor } from "./actor";
import { resolveActor, ActorUnavailableError } from "./resolve-actor";
import { findSession } from "./session";
import { readSessionCookie } from "./cookies";
import { MFA_REQUIRED_ROLES } from "@/server/policies/permissions";
import { userRepository } from "@/server/repositories/user.repository";
import { missingAgreementsFor } from "@/server/services/agreement.service";

export type CurrentAuth = {
  actor: Actor;
  sessionId: string;
  email: string;
  emailVerified: boolean;
  mfaRequired: boolean;
  mfaEnrolled: boolean;
  mfaPassed: boolean;
  missingAgreements: number;
};

/**
 * Resolve the current request's authentication state once per request (React cache).
 * Returns null when there is no live session.
 */
export const getCurrentAuth = cache(async (): Promise<CurrentAuth | null> => {
  const token = await readSessionCookie();
  const session = await findSession(prisma, token);
  if (!session) return null;
  let actor: Actor;
  try {
    actor = await resolveActor(prisma, session.userId);
  } catch (e) {
    if (e instanceof ActorUnavailableError) return null;
    throw e;
  }
  const flags = await userRepository.authFlags(prisma, session.userId);
  const mfaRequired = MFA_REQUIRED_ROLES.includes(actor.role);
  const missing = await missingAgreementsFor(prisma, actor);
  return {
    actor,
    sessionId: session.id,
    email: flags?.email ?? "",
    emailVerified: !!flags?.emailVerifiedAt,
    mfaRequired,
    mfaEnrolled: !!flags?.mfaEnabled,
    mfaPassed: session.mfaPassed,
    missingAgreements: missing.length,
  };
});

export type GateStage = "session" | "mfa" | "email" | "agreements";

/**
 * Where an authenticated user must go before they may use the app, or null when fully admitted.
 * Order: MFA (staff) → email verification (clients, agents) → agreements (INV-I2).
 */
export function nextGate(auth: CurrentAuth): string | null {
  if (auth.mfaRequired && !auth.mfaEnrolled) return "/mfa/setup";
  if (auth.mfaRequired && !auth.mfaPassed) return "/mfa/verify";
  if ((auth.actor.role === "CLIENT" || auth.actor.role === "AGENT") && !auth.emailVerified) return "/verify-email";
  if (auth.missingAgreements > 0) return "/agreements";
  return null;
}

/**
 * For app layouts and server actions: redirects to login or to the next gate.
 * `upTo` lets gate pages themselves require only the earlier stages.
 */
export async function requireAuth(upTo: GateStage = "agreements"): Promise<CurrentAuth> {
  const auth = await getCurrentAuth();
  if (!auth) redirect("/login");
  const gate = nextGate(auth);
  if (gate) {
    const stageOf: Record<string, GateStage> = { "/mfa/setup": "mfa", "/mfa/verify": "mfa", "/verify-email": "email", "/agreements": "agreements" };
    const order: GateStage[] = ["session", "mfa", "email", "agreements"];
    if (order.indexOf(stageOf[gate]) > order.indexOf(upTo)) return auth;
    redirect(gate);
  }
  return auth;
}

export async function requireActor(): Promise<Actor> {
  return (await requireAuth()).actor;
}

/** Landing page after login or a completed gate, by role. */
export function homeFor(role: Actor["role"]): string {
  return "/dashboard";
}
