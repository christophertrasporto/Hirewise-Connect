import type { Metadata } from "next";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { listOpportunitiesForAgency, agencySubmissions } from "@/server/services/opportunity.service";
import { ForbiddenError } from "@/server/policies/authorize";
import { Card, StatusBadge, EmptyState, Banner, fmtDate } from "@/components/app/ui";
import { SubmitAgentForm, WithdrawSubmissionForm } from "@/components/opportunities/Forms";
import { labelFor } from "@/lib/options";

export const metadata: Metadata = { title: "Opportunities" };

/** Agency portal → Opportunities (v2 phase 6b): open roles with the client masked, the agency's own submissions, and eligible members. */
export default async function AgencyOpportunitiesPage() {
  const actor = await requireActor();
  let data: Awaited<ReturnType<typeof listOpportunitiesForAgency>>;
  try {
    data = await listOpportunitiesForAgency(prisma, actor);
  } catch (e) {
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="Opportunities are paused">{e.message}</Banner>;
    throw e;
  }
  const submissions = await agencySubmissions(prisma, actor);
  const canSubmit = actor.permissions.has("agency.submissions.create") && actor.agency?.status === "ACTIVE";
  const members = data.members.map((m) => ({ id: m.id, displayName: m.displayName, primaryRole: m.primaryRole, eligible: m.eligible, reason: m.reason }));
  return (
    <div className="space-y-5">
      <Card title={`Open opportunities (${data.opportunities.length})`} description={`Clients are shown as a masked label until Hirewise schedules an interview. Up to ${data.maxSubmissionsPerAgency} open submissions per opportunity. Only agents with an active membership, an approved profile, availability, and an active credential can be submitted.`}>
        {data.opportunities.length === 0 ? <EmptyState title="No open opportunities" description="Hirewise shares client roles here as they come in." /> : (
          <div className="grid gap-4 lg:grid-cols-2">
            {data.opportunities.map((o) => (
              <div key={o.id} className="rounded-2xl border border-ink-100 p-4">
                <div className="flex items-start justify-between gap-3"><div><p className="text-[15px] font-bold text-ink-900">{o.title}</p><p className="text-[12.5px] text-ink-500">{o.clientLabel} · {o.schedule ?? "schedule to be confirmed"}{o.timezone ? ` · ${o.timezone}` : ""} · {o.openSlots} open slot(s)</p></div><StatusBadge status={o.status} /></div>
                <p className="mt-2 text-[13.5px] text-ink-700">{o.roleSummary.slice(0, 280)}{o.roleSummary.length > 280 ? "…" : ""}</p>
                {o.skills.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{o.skills.map((s) => <span key={s} className="rounded-full bg-ink-100 px-2 py-0.5 text-[11.5px] font-medium text-ink-700">{s}</span>)}</div>}
                {o.mySubmissions.length > 0 && <ul className="mt-3 space-y-1 text-[13px]">{o.mySubmissions.map((s) => <li key={s.id} className="flex items-center justify-between gap-2"><span>{s.displayName} · {labelFor(s.status)}{s.reviewNote ? <span className="text-ink-500"> · {s.reviewNote}</span> : null}</span>{canSubmit && (s.status === "PENDING_REVIEW" || s.status === "APPROVED_FOR_CLIENT") && <WithdrawSubmissionForm submissionId={s.id} />}</li>)}</ul>}
                {canSubmit && <div className="mt-3"><SubmitAgentForm opportunityId={o.id} members={members} disabledReason={members.length === 0 ? "No active members to submit yet." : null} /></div>}
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card title={`Submission history (${submissions.length})`} description="Only your agency's submissions. Interviews and placements that follow show under the agent's record.">
        {submissions.length === 0 ? <EmptyState title="No submissions yet" /> : (
          <ul className="divide-y divide-ink-100 text-[13.5px]">{submissions.map((s) => <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span><span className="font-semibold text-ink-900">{s.displayName}</span> · {s.opportunity.title} · {s.opportunity.clientLabel} · {fmtDate(s.createdAt)}</span><StatusBadge status={s.status} /></li>)}</ul>
        )}
      </Card>
    </div>
  );
}
