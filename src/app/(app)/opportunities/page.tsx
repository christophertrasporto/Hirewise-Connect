import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { listOpportunitiesForClient, listOpportunitiesForAgent } from "@/server/services/opportunity.service";
import { ForbiddenError } from "@/server/policies/authorize";
import { PageHeader, Card, StatusBadge, EmptyState, Banner, fmtDate } from "@/components/app/ui";
import { SubmitAgentForm } from "@/components/opportunities/Forms";
import { labelFor } from "@/lib/options";

export const metadata: Metadata = { title: "Opportunities" };

/** Clients see the opportunities Hirewise published from their requirements; talent sees open roles with the client masked (v2 phase 6b). */
export default async function OpportunitiesPage() {
  const actor = await requireActor();
  if (actor.role === "CLIENT") {
    let rows: Awaited<ReturnType<typeof listOpportunitiesForClient>>;
    try {
      rows = await listOpportunitiesForClient(prisma, actor);
    } catch (e) {
      if (e instanceof ForbiddenError) return <Banner tone="warn" title="Marketplace not open yet">{e.message}</Banner>;
      throw e;
    }
    return (
      <>
        <PageHeader eyebrow="Opportunities" title="Your opportunities" description="Hirewise publishes your requirements to Partner Teams and Hirewise Direct talent, reviews every submission, and shows you only approved candidates. Request interviews from here." actions={<Link href="/requirements" className="rounded-full border border-ink-200 bg-white px-4 py-1.5 text-[13.5px] font-semibold text-ink-700">Requirements</Link>} />
        {rows.length === 0 ? <EmptyState title="No opportunities yet" description="Add a requirement; your account manager publishes it as an opportunity." /> : (
          <div className="grid gap-4 md:grid-cols-2">
            {rows.map((o) => (
              <Card key={o.id} title={<span className="flex items-center gap-2"><Link href={`/opportunities/${o.id}`} className="hover:text-brand-700">{o.title}</Link> <StatusBadge status={o.status} /></span>} description={`${o.headcount} position(s) · published ${fmtDate(o.publishedAt)} · ${o.visibility}`}>
                <p className="text-[13.5px] text-ink-700">{o.roleSummary.slice(0, 220)}{o.roleSummary.length > 220 ? "…" : ""}</p>
                <p className="mt-2 text-[12.5px] text-ink-500">{o.candidatesApproved} approved candidate(s) · {o.candidatesInReview} in Hirewise review</p>
                <Link href={`/opportunities/${o.id}`} className="mt-3 inline-flex h-9 items-center rounded-full border border-ink-200 bg-white px-3.5 text-[13px] font-semibold text-ink-800 hover:bg-ink-50">Open</Link>
              </Card>
            ))}
          </div>
        )}
      </>
    );
  }
  if (actor.role === "AGENT") {
    const { opportunities, agencyAgent, eligibility } = await listOpportunitiesForAgent(prisma, actor);
    return (
      <>
        <PageHeader eyebrow="Opportunities" title={agencyAgent ? "Opportunities your agency put you forward for" : "Open opportunities"} description={agencyAgent ? "Your agency submits you to client opportunities; Hirewise reviews and the client decides. You see the role and the status, never the client until an interview is scheduled." : "Hirewise Direct talent apply through Hirewise. The client is shown as a masked label until an interview is scheduled."} />
        {!agencyAgent && eligibility && !eligibility.eligible && <div className="mb-5"><Banner tone="warn" title="Not eligible to apply yet">{eligibility.reason}</Banner></div>}
        {opportunities.length === 0 ? <EmptyState title="Nothing here yet" /> : (
          <div className="grid gap-4 md:grid-cols-2">
            {opportunities.map((o) => (
              <Card key={o.id} title={<span className="flex items-center gap-2">{o.title} <StatusBadge status={o.status} /></span>} description={`${o.clientLabel} · ${o.schedule ?? "schedule to be confirmed"}${o.timezone ? ` · ${o.timezone}` : ""}`}>
                <p className="text-[13.5px] text-ink-700">{o.roleSummary.slice(0, 260)}{o.roleSummary.length > 260 ? "…" : ""}</p>
                {o.skills.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{o.skills.map((s) => <span key={s} className="rounded-full bg-ink-100 px-2 py-0.5 text-[11.5px] font-medium text-ink-700">{s}</span>)}</div>}
                <div className="mt-3">
                  {o.mySubmission ? <p className="text-[13px] text-ink-700">Your submission: <StatusBadge status={o.mySubmission.status} />{o.mySubmission.reviewNote ? <span className="ml-2 text-ink-500">{o.mySubmission.reviewNote}</span> : null}</p> : agencyAgent ? null : <SubmitAgentForm opportunityId={o.id} fixedAgentProfileId={actor.agentProfileId!} disabledReason={eligibility && !eligibility.eligible ? eligibility.reason : null} />}
                </div>
              </Card>
            ))}
          </div>
        )}
      </>
    );
  }
  return <Banner tone="info" title="Opportunities">{labelFor(actor.role)} accounts manage opportunities under Staff → Opportunities, or through the agency portal.</Banner>;
}
