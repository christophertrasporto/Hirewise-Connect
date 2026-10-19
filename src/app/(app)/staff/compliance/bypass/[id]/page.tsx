import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { getBypassReport } from "@/server/services/bypass.service";
import { NotFoundError } from "@/server/policies/authorize";
import { PageHeader, Card, StatusBadge, fmtDate } from "@/components/app/ui";
import { BypassActions, BypassEvidenceUploader, BypassEvidenceLink, BypassHistory } from "@/components/communication/Forms";

export const metadata: Metadata = { title: "Bypass case" };

export default async function BypassCasePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  let r: Awaited<ReturnType<typeof getBypassReport>>;
  try {
    r = await getBypassReport(prisma, actor, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  if (!("reported" in r)) notFound();
  const canReview = actor.permissions.has("bypass.review");
  return (
    <>
      <Link href="/staff/compliance/bypass" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> Bypass reports</Link>
      <PageHeader eyebrow="Bypass case" title={r.reported.label ?? "Unspecified party"} description={`Reported ${fmtDate(r.createdAt)} by ${r.reporter.email} (${r.reporter.role.toLowerCase().replace(/_/g, " ")})${r.relatedType ? ` · about ${r.relatedType} ${r.relatedId}` : ""}`} actions={<StatusBadge status={r.status} />} />
      <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-5">
          <Card title="Report"><p className="whitespace-pre-line text-[15px] leading-relaxed text-ink-700">{r.description}</p></Card>
          <Card title="Reported party">
            <dl className="grid gap-3 text-[14px] sm:grid-cols-2">
              <div><dt className="text-ink-400">Role</dt><dd className="font-semibold text-ink-900">{r.reported.role ?? (r.reported.agencyId ? "Agency" : r.reported.clientId ? "Client" : "—")}</dd></div>
              <div><dt className="text-ink-400">Account status</dt><dd className="font-semibold text-ink-900">{r.reported.userStatus ?? r.reported.agencyStatus ?? r.reported.clientStatus ?? "—"}</dd></div>
              {r.reported.agentProfileId && <div><dt className="text-ink-400">Profile</dt><dd><Link href={`/staff/talent/${r.reported.agentProfileId}`} className="font-semibold text-brand-600">Open talent profile</Link> · {r.reported.agentStatus}</dd></div>}
              {r.reported.agencyId && <div><dt className="text-ink-400">Agency</dt><dd><Link href={`/staff/agencies/${r.reported.agencyId}`} className="font-semibold text-brand-600">Open agency</Link></dd></div>}
              {r.restrictionEndsAt && <div><dt className="text-ink-400">Restriction ends</dt><dd className="font-semibold text-ink-900">{fmtDate(r.restrictionEndsAt)}</dd></div>}
            </dl>
          </Card>
          <Card title="Evidence">
            {r.evidenceDocumentIds.length === 0 ? <p className="text-[13px] text-ink-400">No attachments.</p> : <ul className="space-y-1">{r.evidenceDocumentIds.map((d, i) => <li key={d}><BypassEvidenceLink reportId={r.id} documentId={d} name={`Attachment ${i + 1}`} /></li>)}</ul>}
            {r.status !== "CLOSED" && <div className="mt-3"><BypassEvidenceUploader reportId={r.id} /></div>}
          </Card>
        </div>
        <div className="space-y-5">
          {canReview && <Card title="Decision" description="Warnings notify the reported party. Restrictions hide an agent or suspend a client or agency with an end date. Suspension needs user.manage."><BypassActions reportId={r.id} status={r.status} canSuspend={actor.permissions.has("user.manage")} /></Card>}
          <Card title="History"><BypassHistory history={r.history} /></Card>
          {r.decisionNotes && <Card title="Latest decision note"><p className="text-[14px] text-ink-700">{r.decisionNotes}</p></Card>}
        </div>
      </div>
    </>
  );
}
