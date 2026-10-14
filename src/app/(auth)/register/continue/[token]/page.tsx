import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db/client";
import { AuthShell } from "@/components/auth/AuthShell";
import { AgentRegisterForm } from "@/components/auth/AgentRegisterForm";
import { ApplicantRegisterForm } from "@/components/auth/ApplicantRegisterForm";
import { getCurrentAuth, HOME_PATH } from "@/server/auth/require-actor";
import { describeContinuation } from "@/server/services/identity.service";
import { termsForRole } from "@/server/services/terms.service";

export const metadata: Metadata = { title: "Continue your sign-up" };

/** Identity phase 1: a flagged sign-up that Admin approved continues here with the email fixed and detection skipped. */
export default async function ContinueSignupPage({ params }: { params: Promise<{ token: string }> }) {
  if (await getCurrentAuth()) redirect(HOME_PATH);
  const { token } = await params;
  const info = await describeContinuation(prisma, token);
  if (!info) {
    return (
      <AuthShell>
        <div className="w-full max-w-[520px]">
          <h1 className="text-[2rem] font-bold leading-tight">This sign-up link is no longer valid</h1>
          <p className="mt-3 text-[15px] text-ink-500">It may have expired or already been used. Start again from the registration page; if your details match an existing account, Hirewise will review it once more.</p>
          <Link href="/register" className="mt-6 inline-flex rounded-full bg-ink-900 px-5 py-2.5 text-[14px] font-semibold text-white hover:bg-ink-800">Back to registration</Link>
        </div>
      </AuthShell>
    );
  }
  const continuation = { token, email: info.email };
  if (info.kind === "AGENCY_APPLICATION") {
    const terms = await termsForRole(prisma, "APPLICANT");
    return (
      <AuthShell>
        <ApplicantRegisterForm terms={terms} continuation={continuation} />
      </AuthShell>
    );
  }
  const terms = await termsForRole(prisma, "AGENT");
  return (
    <AuthShell>
      <AgentRegisterForm terms={terms} continuation={continuation} />
    </AuthShell>
  );
}
