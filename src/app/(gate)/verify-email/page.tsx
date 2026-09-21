import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MailCheck } from "lucide-react";
import { requireAuth, nextGate, HOME_PATH } from "@/server/auth/require-actor";
import { ResendVerification } from "@/components/gate/ResendVerification";

export const metadata: Metadata = { title: "Verify your email" };

export default async function VerifyEmailPage() {
  const auth = await requireAuth("mfa");
  if (auth.emailVerified) redirect(nextGate(auth) ?? HOME_PATH);
  return (
    <div className="mx-auto max-w-[520px] rounded-3xl border border-ink-100 bg-white p-8 shadow-soft">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-200">
        <MailCheck className="h-6 w-6" />
      </span>
      <h1 className="mt-5 text-[1.75rem] font-bold leading-tight">Check your inbox</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-500">
        We sent a verification link to <span className="font-semibold text-ink-800">{auth.email}</span>. Open it to continue. The link expires in 24 hours.
      </p>
      <ResendVerification />
    </div>
  );
}
