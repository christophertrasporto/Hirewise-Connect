import type { Metadata } from "next";
import { ShieldCheck, ShieldX } from "lucide-react";
import { prisma } from "@/server/db/client";
import { verifyCertificate } from "@/server/services/certification.service";

export const metadata: Metadata = { title: "Verify a certificate", description: "Check whether a Hirewise VA Academy certificate is genuine and current." };
export const dynamic = "force-dynamic";

const fmt = (d: Date | null) => (d ? d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "");

/** Public, unauthenticated verification by the code printed on the certificate. Shows the minimum needed to confirm it. */
export default async function VerifyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const r = await verifyCertificate(prisma, decodeURIComponent(code));
  return (
    <section className="mx-auto max-w-[680px] px-4 py-16 sm:py-24">
      <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-brand-700">Certificate verification</p>
      <h1 className="mt-2 font-display text-[2rem] font-extrabold leading-tight text-ink-900 sm:text-[2.6rem]">{r.found ? (r.valid ? "This certificate is valid." : "This certificate is not currently valid.") : "No certificate matches this code."}</h1>
      <p className="mt-3 text-[15px] text-ink-600">Code <span className="font-mono font-semibold text-ink-900">{decodeURIComponent(code).toUpperCase()}</span></p>
      <div className={`mt-8 rounded-3xl border p-6 sm:p-8 ${r.valid ? "border-brand-200 bg-brand-50/50" : "border-ink-200 bg-ink-50/60"}`}>
        <p className="inline-flex items-center gap-2 text-[14px] font-semibold text-ink-900">{r.valid ? <ShieldCheck className="h-5 w-5 text-brand-600" /> : <ShieldX className="h-5 w-5 text-ink-400" />} {r.found ? (r.status === "APPROVED" ? "Approved" : r.status === "EXPIRED" ? "Expired" : r.status === "REVOKED" ? "Revoked" : r.status === "PENDING_REVIEW" ? "Awaiting approval" : r.status) : "Not found"}</p>
        {r.found && (
          <dl className="mt-5 grid gap-4 text-[14px] sm:grid-cols-2">
            <div><dt className="text-ink-400">Certificate ID</dt><dd className="font-mono font-semibold text-ink-900">{r.certificateNumber ?? "—"}</dd></div>
            <div><dt className="text-ink-400">Certification</dt><dd className="font-semibold text-ink-900">{r.templateName}</dd></div>
            <div><dt className="text-ink-400">Issued to</dt><dd className="font-semibold text-ink-900">{r.learnerName}</dd></div>
            {r.courseTitle && <div><dt className="text-ink-400">Course</dt><dd className="font-semibold text-ink-900">{r.courseTitle}</dd></div>}
            <div><dt className="text-ink-400">Issued</dt><dd className="font-semibold text-ink-900">{fmt(r.issuedAt)}</dd></div>
            <div><dt className="text-ink-400">Valid until</dt><dd className="font-semibold text-ink-900">{r.expiresAt ? fmt(r.expiresAt) : "No expiry"}</dd></div>
          </dl>
        )}
        {!r.found && <p className="mt-3 text-[14px] text-ink-600">Check the code on the certificate for typos. Codes look like XXXX-XXXX-XXXX. If it still does not match, the certificate was not issued by Hirewise Connect.</p>}
      </div>
    </section>
  );
}
