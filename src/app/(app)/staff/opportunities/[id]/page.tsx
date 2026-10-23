import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { getOpportunityForStaff } from "@/server/services/opportunity.service";
import { NotFoundError, ForbiddenError, can } from "@/server/policies/authorize";
import { PageHeader, Card, StatusBadge, EmptyState, Banner, fmtDate } from "@/components/app/ui";
import { ReviewSubmissionForm, CloseOpportunityForm, WithdrawSubmissionForm } from "@/components/opportunities/Forms";
import { RequirementsForm } from "@/components/opportunities/RequirementsForm";
import { listSkillTags } from "@/server/services/skills.service";
import { listTemplates } from "@/server/services/certification.service";
import { labelFor } from "@/lib/options";

export const metadata: Metadata = { title: "Opportunity" };

export default async function StaffOpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  let o: Awaited<ReturnType<typeof getOpportunityForStaff>>;
  try {
    o = await getOpportunityForStaff(prisma, actor, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="Not available">{e.message}</Banner>;
    throw e;
  }
  const canManage = can(actor, "opportunity.manage");
  const [tags, templates] = canManage ? await Promise.all([listSkillTags(prisma, actor, true).catch(() => []), listTemplates(prisma)]) : [[], []];
  const open = o.status === "OPEN" || o.status === "INTERVIEWING";
  return (
    <>
      <Link href="/staff/opportunities" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> Opportunities</Link>
      <PageHeader eyebrow={`${o.client.companyName} · shown as “${o.maskedClientLabel}”`} title={o.title} description={`${o.headcount} position(s) · ${labelFor(o.visibility)}${o.sharedWith.length ? ` (${o.sharedWith.map((a) => a.name).join(", ")})` : ""} · published ${fmtDate(o.publishedAt)} by ${o.publishedBy}${o.closedReason ? ` · closed: ${o.closedReason}` : ""}`} actions={<StatusBadge status={o.status} />} />
      <div className="grid gap-5 lg:grid-cols-[1.4fr_0.6fr]">
        <div className="space-y-5">
          <Card title={`Submissions (${o.submissions.length})`} description="Approve to show the candidate to the client; decline with a note to the submitter.">
            {o.submissions.length === 0 ? <EmptyState title="No submissions yet" /> : (
              <ul className="divide-y divide-ink-100">
                {o.submissions.map((s) => (
                  <li key={s.id} className="py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div><Link href={`/staff/talent/${s.agentProfileId}`} className="text-[15px] font-semibold text-ink-900 hover:text-brand-700">{s.displayName}</Link><span className="ml-2 text-[12.5px] text-ink-400">clients see “{s.clientLabel ?? "label pending"}”</span><p className="text-[12.5px] text-ink-500">{s.agency ? `${s.agency.name} (${s.agency.code ?? "no code"})` : "Hirewise Direct"} · submitted by {s.submittedBy} · {fmtDate(s.createdAt)} · {labelFor(s.availabilityStatus)} · {labelFor(s.verificationLevel)}</p></div>
                      <StatusBadge status={s.status} />
                    </div>
                    {s.note && <p className="mt-1 text-[13.5px] text-ink-700">{s.note}</p>}
                    {s.reviewNote && <p className="mt-1 text-[12.5px] text-ink-500">Review note: {s.reviewNote}</p>}
                    {s.withdrawnReason && <p className="mt-1 text-[12.5px] text-ink-500">Withdrawn: {s.withdrawnReason}</p>}
                    {s.interviewRequestId && <Link href={`/staff/interviews/${s.interviewRequestId}`} className="mt-1 inline-block text-[12.5px] font-semibold text-brand-600">Interview request</Link>}
                    {canManage && s.status === "PENDING_REVIEW" && <div className="mt-2"><ReviewSubmissionForm submissionId={s.id} /></div>}
                    {canManage && s.status === "APPROVED_FOR_CLIENT" && <div className="mt-2"><WithdrawSubmissionForm submissionId={s.id} /></div>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="space-y-5">
          <Card title="Role"><p className="whitespace-pre-line text-[14px] text-ink-700">{o.roleSummary}</p>{o.skills.length > 0 && <p className="mt-2 text-[12.5px] text-ink-500">Skills: {o.skills.join(", ")}</p>}{o.software.length > 0 && <p className="text-[12.5px] text-ink-500">Software: {o.software.join(", ")}</p>}<p className="mt-2 text-[12.5px] text-ink-500">{o.schedule ?? "Schedule to be confirmed"}{o.timezone ? ` · ${o.timezone}` : ""}{o.startDate ? ` · start ${fmtDate(o.startDate)}` : ""}</p><Link href={`/staff/requirements/${o.requirementId}`} className="mt-2 inline-block text-[12.5px] font-semibold text-brand-600">Open the requirement</Link></Card>
          <Card title="Requirements" description="Every requirement must be met before an agent can be submitted. Declared tags were seeded from the client's requirement; raise one to Verified or add a certification to make it a hard rule.">
            {o.requirements.length === 0 ? <p className="text-[13px] text-ink-400">No requirements yet.</p> : <div className="mb-3 flex flex-wrap gap-1">{o.requirements.map((r) => <span key={r.id} className={`rounded-full px-2 py-0.5 text-[11.5px] font-medium ${r.requiredLevel === "DECLARED" ? "bg-ink-100 text-ink-700" : "bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200"}`}>{r.label}</span>)}</div>}
            {canManage && open && <RequirementsForm opportunityId={o.id} tags={tags.map((t) => ({ id: t.id, name: t.name, hashtag: t.hashtag, category: t.category }))} templates={templates.filter((t) => t.isActive).map((t) => ({ id: t.id, name: t.name }))} current={o.requirements} />}
          </Card>
          {canManage && open && <Card title="Close" description="Filled marks the requirement filled; both withdraw pending and approved submissions."><CloseOpportunityForm opportunityId={o.id} /></Card>}
        </div>
      </div>
    </>
  );
}
