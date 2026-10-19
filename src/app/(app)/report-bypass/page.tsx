import type { Metadata } from "next";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { myBypassReports } from "@/server/services/bypass.service";
import { PageHeader, Card, StatusBadge, EmptyState, fmtDate } from "@/components/app/ui";
import { ReportBypassForm, BypassEvidenceUploader } from "@/components/communication/Forms";

export const metadata: Metadata = { title: "Report a bypass attempt" };

/** General entry point for "Report Direct Contact / Bypass Attempt" and the reporter's own cases (v2 phase 6a). */
export default async function ReportBypassPage() {
  const actor = await requireActor();
  const mine = await myBypassReports(prisma, actor);
  return (
    <>
      <PageHeader eyebrow="Platform rules" title="Report direct contact or a bypass attempt" description="Hiring, interviews, and payment run through Hirewise Connect. If someone tries to take the relationship off the platform, tell us here. Hirewise reviews every report; a report alone never suspends anyone." />
      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <Card title="New report"><ReportBypassForm /></Card>
        <Card title="Your reports" description="You will be notified when Hirewise decides on a case.">
          {mine.length === 0 ? <EmptyState title="No reports yet" /> : (
            <ul className="divide-y divide-ink-100">
              {mine.map((r) => (
                <li key={r.id} className="py-3">
                  <div className="flex items-center justify-between gap-3"><p className="text-[13.5px] font-semibold text-ink-900">{fmtDate(r.createdAt)}</p><StatusBadge status={r.status} /></div>
                  <p className="mt-1 text-[13px] text-ink-600">{r.description}</p>
                  <p className="mt-1 text-[12px] text-ink-400">{r.evidenceCount} attachment(s)</p>
                  {r.status !== "CLOSED" && <div className="mt-2"><BypassEvidenceUploader reportId={r.id} /></div>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
