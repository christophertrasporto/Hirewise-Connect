import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAuth, nextGate, HOME_PATH } from "@/server/auth/require-actor";
import { MfaSetup } from "@/components/gate/MfaSetup";

export const metadata: Metadata = { title: "Set up two-factor authentication" };

export default async function MfaSetupPage() {
  const auth = await requireAuth("session");
  if (!auth.mfaRequired) redirect(nextGate(auth) ?? HOME_PATH);
  if (auth.mfaEnrolled) redirect("/mfa/verify");
  return (
    <div className="mx-auto max-w-[560px] rounded-3xl border border-ink-100 bg-white p-8 shadow-soft">
      <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-brand-600">Required for {auth.actor.role === "SUPER_ADMIN" ? "owners" : "admins"}</p>
      <h1 className="mt-3 text-[1.75rem] font-bold leading-tight">Set up two-factor authentication</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-500">Scan the code with Google Authenticator, 1Password, Authy, or any TOTP app, then enter the six-digit code to finish.</p>
      <MfaSetup />
    </div>
  );
}
