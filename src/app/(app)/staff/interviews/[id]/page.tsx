import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Video } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { getRequest } from "@/server/services/interview.service";
import { listMessages } from "@/server/services/message.service";
import { NotFoundError } from "@/server/policies/authorize";
import { PageHeader, Card, StatusBadge, Banner, EmptyState } from "@/components/app/ui";
import { MessageThread } from "@/components/interviews/MessageThread";
import { WorkflowButton, CompleteInterviewForm } from "@/components/interviews/RequestActions";
import { ScheduleForm } from "@/components/interviews/ScheduleForm";
import { labelFor } from "@/lib/options";

export const metadata: Metadata = { title: "Interview request" };

function fmt(d: Date | string, tz: string) {
  return new Date(d).toLocaleString("en-US", { timeZone: tz, dateStyle: "medium", timeStyle: "short" });
}

export default async function StaffInterviewRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  let data: Awaited<ReturnType<typeof getRequest>>;
  try {
    data = await getRequest(prisma, actor, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  if (data.audience !== "STAFF") notFound();
  const r = data.request;
  const messages = await listMessages(prisma, actor, id);
  const canCoordinate = actor.permissions.has("interview.coordinate");
  const canSchedule = actor.permissions.has("interview.schedule");
  const closed = ["CLOSED", "CANCELLED"].includes(r.status);

  return (
    <>
      <Link href="/staff/interviews" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> All requests</Link>
      <PageHeader eyebrow={r.client.companyName} title={`${r.role} · ${r.candidates.length} candidate(s)`} description={`Contact: ${r.client.contactName ?? "—"} (${r.client.contactEmail ?? "—"}) · client timezone ${r.client.timezone ?? "—"} · assigned to ${r.assignedSales?.email ?? "nobody yet"}`} actions={<StatusBadge status={r.status} />} />
      {r.status === "CANCELLED" && <div className="mb-6"><Banner tone="danger" title="Cancelled">{r.cancelledReason}</Banner></div>}

      <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-5">
          <Card title="Workflow">
            <div className="space-y-4">
              {r.status === "REQUESTED" && canCoordinate && <WorkflowButton requestId={r.id} op="START_REVIEW" label="Start review (assign to me)" />}
              {r.status === "SALES_REVIEW" && canCoordinate && <WorkflowButton requestId={r.id} op="PROPOSE" label="Send proposed times to client" variant="primary" withMessage="Proposed times, e.g. Thu 2 Oct 9:00 or 10:00 AM PST, 30 minutes each." />}
              {r.status === "CLIENT_CONFIRMATION" && canCoordinate && <div className="space-y-2"><p className="text-[13.5px] text-ink-500">Waiting for the client. If they confirmed by phone, confirm on their behalf:</p><WorkflowButton requestId={r.id} op="CLIENT_CONFIRM" label="Confirm on client&apos;s behalf" variant="outline" withMessage="Note for the record (optional)" /></div>}
              {r.status === "CANDIDATE_CONFIRMATION" && canSchedule && <ScheduleForm requestId={r.id} candidates={r.candidates.map((c) => ({ agentProfileId: c.agentProfileId, displayName: c.displayName, status: c.status }))} defaultTimezone={r.timezone} />}
              {r.status === "SCHEDULED" && <p className="text-[13.5px] text-ink-500">Record each interview outcome below. When none remain scheduled, the client is asked for a decision.</p>}
              {r.status === "CLIENT_DECISION_PENDING" && <p className="text-[13.5px] text-ink-500">Waiting for the client&apos;s decision per candidate.</p>}
              {r.status === "CLOSED" && <p className="text-[13.5px] text-ink-500">Closed. Selected candidates have placement records.</p>}
              {!closed && !["COMPLETED", "CLIENT_DECISION_PENDING"].includes(r.status) && canCoordinate && <WorkflowButton requestId={r.id} op="CANCEL" label="Cancel request" variant="danger" withReason />}
            </div>
          </Card>

          <Card title="Candidates">
            <ul className="space-y-3">
              {r.candidates.map((c) => {
                const ivs = r.interviews.filter((i) => i.agentProfileId === c.agentProfileId);
                return (
                  <li key={c.agentProfileId} className="rounded-2xl border border-ink-100 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <Link href={`/staff/talent/${c.agentProfileId}`} className="text-[15px] font-semibold text-ink-900 hover:text-brand-700">{c.displayName}</Link>
                        {c.legalName && <span className="ml-2 text-[13px] text-ink-500">({c.legalName})</span>}
                        <p className="text-[12.5px] text-ink-400">{c.primaryRole ?? "—"} · {c.timezone ?? "—"} · availability {labelFor(c.availabilityStatus).toLowerCase()}{c.email ? ` · ${c.email}` : ""}</p>
                      </div>
                      <StatusBadge status={c.status} />
                    </div>
                    {ivs.map((i) => (
                      <div key={i.id} className="mt-3 rounded-xl bg-ink-50 p-3">
                        <div className="flex items-center justify-between"><p className="text-[13.5px] font-semibold">Round {i.round} · {fmt(i.scheduledAt, i.timezone)} ({i.timezone}) · {i.durationMin} min</p><StatusBadge status={i.status} /></div>
                        {i.meetingLink && <a href={i.meetingLink} target="_blank" rel="noopener" className="mt-1 inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand-600"><Video className="h-3.5 w-3.5" /> {i.meetingLink}</a>}
                        {i.clientDecision !== "NONE" && <p className="mt-1 text-[13px] text-ink-700">Client decision: <span className="font-semibold">{labelFor(i.clientDecision)}</span>{i.clientFeedback ? ` · "${i.clientFeedback}"` : ""}</p>}
                        {i.internalFeedback && <p className="mt-1 text-[13px] text-ink-500">Internal: {i.internalFeedback}</p>}
                        {i.status === "SCHEDULED" && canCoordinate && <div className="mt-3"><CompleteInterviewForm requestId={r.id} interviewId={i.id} /></div>}
                      </div>
                    ))}
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card title="Client request details">
            <dl className="grid gap-3 text-[14px] sm:grid-cols-2">
              <Item k="Schedule" v={r.schedule ?? "TBD"} /><Item k="Timezone" v={r.timezone} /><Item k="Preferred" v={`${r.preferredDate ? new Date(r.preferredDate).toLocaleDateString() : "any date"}${r.preferredTime ? ` · ${r.preferredTime}` : ""}`} /><Item k="Target start" v={r.targetStartDate ? new Date(r.targetStartDate).toLocaleDateString() : "TBD"} />
              {r.requirement && <Item k="Requirement" v={r.requirement.title} />}
              {r.notes && <div className="sm:col-span-2"><Item k="Client notes" v={r.notes} /></div>}
            </dl>
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Mediated thread" description="Choose who sees each message. Client and candidate messages always come to Hirewise first."><MessageThread requestId={r.id} messages={messages} audience="STAFF" closed={closed} /></Card>
          {canCoordinate && <Card title="Sales notes" description="Internal. Never shown to the client or candidates."><WorkflowButton requestId={r.id} op="SALES_NOTES" label="Save notes" variant="outline" withMessage="Commercial context, proposed rate band, objections…" defaultText={r.salesNotes ?? ""} /></Card>}
          {r.interviews.length === 0 && <EmptyState title="No interviews yet" />}
        </div>
      </div>
    </>
  );
}

function Item({ k, v }: { k: string; v: string }) {
  return (<div><dt className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">{k}</dt><dd className="mt-0.5 font-medium break-words text-ink-800">{v}</dd></div>);
}
