import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { getIncident } from "@/server/services/incident.service";
import { NotFoundError } from "@/server/policies/authorize";
import { PageHeader, Card, StatusBadge, EmptyState, fmtDate } from "@/components/app/ui";
import { IncidentActions, EvidenceUploader, EvidenceLink } from "@/components/phase5/IncidentForms";
import { labelFor } from "@/lib/options";

export const metadata: Metadata = { title: "Incident" };

export default async function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  let i: Awaited<ReturnType<typeof getIncident>>;
  try {
    i = await getIncident(prisma, actor, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const subjectHref = i.subject.agentProfileId ? `/staff/talent/${i.subject.agentProfileId}` : i.subject.clientId ? `/staff/clients` : null;
  return (
    <>
      <Link href="/staff/compliance/incidents" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> Incidents</Link>
      <PageHeader eyebrow={`${i.severity} severity`} title={`${labelFor(i.type)} · ${i.subject.label}`} description={`Reported by ${i.reportedBy} on ${fmtDate(i.createdAt)}${i.resolvedAt ? ` · closed ${fmtDate(i.resolvedAt)} by ${i.resolvedBy}` : ""}`} actions={<><StatusBadge status={i.status} /><StatusBadge status={i.subject.status} /></>} />
      <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-5">
          <Card title="Description"><p className="whitespace-pre-line text-[14.5px] leading-relaxed text-ink-700">{i.description}</p>{i.relatedType && i.relatedId && <p className="mt-3 text-[13px] text-ink-500">Related: {i.relatedType} {i.relatedType === "InterviewRequest" ? <Link href={`/staff/interviews/${i.relatedId}`} className="font-semibold text-brand-600">open</Link> : i.relatedId}</p>}{i.resolution && <p className="mt-3 rounded-xl bg-brand-50 px-3 py-2 text-[13.5px] text-brand-800"><span className="font-semibold">Resolution:</span> {i.resolution}</p>}</Card>
          <Card title="Evidence" description="Documents stay internal and are served by signed URL only.">
            {i.evidence.length === 0 ? <p className="mb-3 text-[13.5px] text-ink-400">No evidence attached.</p> : <ul className="mb-4 space-y-1.5">{i.evidence.map((e) => <li key={e.id} className="text-[13.5px]"><EvidenceLink incidentId={i.id} documentId={e.id} name={e.name} /> <span className="text-ink-400">· {e.uploadedBy} · {fmtDate(e.createdAt)}</span></li>)}</ul>}
            {actor.permissions.has("incident.write") && (i.status === "OPEN" || i.status === "UNDER_REVIEW") && <EvidenceUploader incidentId={i.id} />}
          </Card>
          <Card title="History for this user">
            {i.history.length === 0 ? <EmptyState title="No other incidents" /> : <ul className="divide-y divide-ink-100 text-[13.5px]">{i.history.map((h) => <li key={h.id} className="flex items-center justify-between py-2"><Link href={`/staff/compliance/incidents/${h.id}`} className="font-semibold text-brand-600">{labelFor(h.type)}</Link><span className="text-ink-500">{h.severity.toLowerCase()} · {fmtDate(h.createdAt)}</span><StatusBadge status={h.status} /></li>)}</ul>}
          </Card>
        </div>
        <div className="space-y-5">
          <Card title="Actions"><IncidentActions incidentId={i.id} status={i.status} subjectUserId={i.subject.userId} subjectStatus={i.subject.status} canResolve={actor.permissions.has("incident.read")} canSuspend={actor.permissions.has("user.manage")} /></Card>
          <Card title="Subject">
            <dl className="space-y-2 text-[14px]">
              <div><dt className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Account</dt><dd className="font-medium text-ink-800">{subjectHref ? <Link href={subjectHref} className="text-brand-600">{i.subject.label}</Link> : i.subject.label} <span className="text-ink-400">· {i.subject.role.toLowerCase()}</span></dd></div>
              <div><dt className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Email</dt><dd className="font-medium text-ink-800">{actor.permissions.has("incident.read") ? i.subject.email : "Hidden"}</dd></div>
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
