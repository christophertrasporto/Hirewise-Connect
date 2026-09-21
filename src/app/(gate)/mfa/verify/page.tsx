import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { requireAuth, nextGate, HOME_PATH } from "@/server/auth/require-actor";
import { MfaVerify } from "@/components/gate/MfaVerify";

export const metadata: Metadata = { title: "Two-factor code" };

export default async function MfaVerifyPage() {
  const auth = await requireAuth("session");
  if (!auth.mfaRequired || auth.mfaPassed) redirect(nextGate(auth) ?? HOME_PATH);
  if (!auth.mfaEnrolled) redirect("/mfa/setup");
  return (
    <div className="mx-auto max-w-[440px] rounded-3xl border border-ink-100 bg-white p-8 shadow-soft">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-200">
        <ShieldCheck className="h-6 w-6" />
      </span>
      <h1 className="mt-5 text-[1.75rem] font-bold leading-tight">Enter your two-factor code</h1>
      <p className="mt-2 text-[15px] text-ink-500">Open your authenticator app and enter the current six-digit code for {auth.email}.</p>
      <MfaVerify />
    </div>
  );
}
