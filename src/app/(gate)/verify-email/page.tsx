import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AlertTriangle, MailCheck } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireAuth, nextGate, HOME_PATH } from "@/server/auth/require-actor";
import { latestVerificationDelivery, VERIFICATION_RESEND_COOLDOWN_SECONDS } from "@/server/services/auth.service";
import { ResendVerification } from "@/components/gate/ResendVerification";
import { fmtDate } from "@/components/app/ui";

export const metadata: Metadata = { title: "Verify your email" };

export default async function VerifyEmailPage() {
  const auth = await requireAuth("mfa");
  if (auth.emailVerified) redirect(nextGate(auth) ?? HOME_PATH);
  const delivery = await latestVerificationDelivery(prisma, auth.email);
  const failed = delivery?.status === "failed";

  return (
    <div className="mx-auto max-w-[520px] rounded-3xl border border-ink-100 bg-white p-8 shadow-soft">
      <span className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl ring-1 ring-inset ${failed ? "bg-gold-50 text-gold-700 ring-gold-200" : "bg-brand-50 text-brand-600 ring-brand-200"}`}>
        {failed ? <AlertTriangle className="h-6 w-6" /> : <MailCheck className="h-6 w-6" />}
      </span>
      <h1 className="mt-5 text-[1.75rem] font-bold leading-tight">{failed ? "We could not send your verification email" : "Check your inbox"}</h1>
      {failed ? (
        <>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-500">
            Your account for <span className="font-semibold text-ink-800">{auth.email}</span> was created, but the email did not go out. Reason:
          </p>
          <p className="mt-3 rounded-2xl bg-gold-50 px-4 py-3 text-[14px] font-medium text-gold-800 ring-1 ring-inset ring-gold-200">{delivery?.error ?? "Unknown delivery error."}</p>
          <p className="mt-3 text-[13.5px] text-ink-500">Try again below. If it keeps failing, contact Hirewise support and quote the reason above.</p>
        </>
      ) : (
        <p className="mt-2 text-[15px] leading-relaxed text-ink-500">
          We sent a verification link to <span className="font-semibold text-ink-800">{auth.email}</span>
          {delivery?.status === "sent" ? ` on ${fmtDate(delivery.at)}` : ""}. Open it to continue. The link expires in 24 hours. Check your spam folder if it has not arrived within a few minutes.
        </p>
      )}
      <ResendVerification cooldownSeconds={VERIFICATION_RESEND_COOLDOWN_SECONDS} />
      <p className="mt-6 text-[12.5px] text-ink-400">Until your email is verified you cannot open your profile, the Academy, or any other part of Hirewise Connect.</p>
    </div>
  );
}
