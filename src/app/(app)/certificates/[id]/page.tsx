import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Award, ShieldCheck } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { certificateForActor } from "@/server/services/certification.service";
import { NotFoundError } from "@/server/policies/authorize";
import { getEnv } from "@/server/env";
import { Banner, fmtDate } from "@/components/app/ui";

export const metadata: Metadata = { title: "Certificate" };

/** The printable certificate: learner, course, completion date, certificate number, coach, and the verification link. */
export default async function CertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  let c: Awaited<ReturnType<typeof certificateForActor>>;
  try {
    c = await certificateForActor(prisma, actor, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const verifyUrl = c.verificationCode ? `${getEnv().APP_URL}/verify/${c.verificationCode}` : null;
  const expired = !!c.expiresAt && c.expiresAt.getTime() < Date.now();

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> Dashboard</Link>
        <span className="text-[12.5px] text-ink-400">Use your browser&apos;s print option to save this certificate as a PDF.</span>
      </div>
      {c.status !== "APPROVED" && <div className="mb-4 print:hidden"><Banner tone="warn" title={c.status === "PENDING_REVIEW" ? "Awaiting approval" : c.status === "REVOKED" ? "Revoked" : c.status}>This certificate is not currently valid.</Banner></div>}
      {expired && c.status === "APPROVED" && <div className="mb-4 print:hidden"><Banner tone="warn" title="Expired">This certificate expired on {fmtDate(c.expiresAt)}.</Banner></div>}

      <article className="mx-auto max-w-[820px] rounded-3xl border border-gold-200 bg-white p-8 shadow-soft sm:p-12 print:border-0 print:shadow-none" aria-label="Certificate">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-gold-700">Hirewise VA Academy</p>
            <p className="mt-1 text-[12.5px] text-ink-400">Certificate of {c.origin === "ADMIN_ISSUED" ? "recognition" : "completion"}</p>
          </div>
          <Award className="h-10 w-10 text-gold-500" aria-hidden="true" />
        </div>
        <p className="mt-10 text-[14px] text-ink-500">This certifies that</p>
        <h1 className="mt-1 font-display text-[2.2rem] font-extrabold leading-tight text-ink-900 sm:text-[2.8rem]">{c.learnerName}</h1>
        <p className="mt-4 text-[14px] text-ink-500">{c.courseTitle ? "has completed the course" : "has been awarded"}</p>
        {c.courseTitle && <p className="mt-1 text-[20px] font-bold text-ink-900">{c.courseTitle}</p>}
        <p className="mt-3 text-[16px] text-ink-700">and is recognised as <span className="font-semibold text-ink-900">{c.templateName}</span>{c.templateDescription ? <span className="block text-[13.5px] text-ink-500">{c.templateDescription}</span> : null}</p>

        <dl className="mt-10 grid gap-4 text-[13.5px] sm:grid-cols-2">
          <div><dt className="text-ink-400">Completion date</dt><dd className="font-semibold text-ink-900">{fmtDate(c.issuedAt)}</dd></div>
          <div><dt className="text-ink-400">Certificate ID</dt><dd className="font-mono font-semibold text-ink-900">{c.certificateNumber ?? "Pending"}</dd></div>
          <div><dt className="text-ink-400">{c.coach ? "Coach" : "Issued by"}</dt><dd className="font-semibold text-ink-900">{c.coach ?? "Hirewise Connect"}</dd></div>
          <div><dt className="text-ink-400">Valid until</dt><dd className="font-semibold text-ink-900">{c.expiresAt ? fmtDate(c.expiresAt) : "No expiry"}</dd></div>
        </dl>

        {verifyUrl && (
          <div className="mt-10 flex flex-wrap items-center gap-3 rounded-2xl bg-ink-50 px-4 py-3 text-[12.5px] text-ink-600">
            <ShieldCheck className="h-4 w-4 text-brand-600" />
            <span>Verify this certificate at <a href={verifyUrl} className="font-mono font-semibold text-brand-700">{verifyUrl}</a></span>
          </div>
        )}
      </article>
    </>
  );
}
