import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Video } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { getRequest } from "@/server/services/interview.service";
import { listMessages } from "@/server/services/message.service";
import { NotFoundError } from "@/server/policies/authorize";
import { PageHeader, Card, StatusBadge, Banner, EmptyState } from "@/components/app/ui";
import { MessageThread } from "@/components/interviews/MessageThread";
import { WorkflowButton, CandidateRespond, DecisionForm } from "@/components/interviews/RequestActions";
import { labelFor } from "@/lib/options";

export const metadata: Metadata = { title: "Interview request" };

const STEPS = ["REQUESTED", "SALES_REVIEW", "CLIENT_CONFIRMATION", "CANDIDATE_CONFIRMATION", "SCHEDULED", "COMPLETED", "CLIENT_DECISION_PENDING", "CLOSED"];
const STEP_LABEL: Record<string, string> = { REQUESTED: "Requested", SALES_REVIEW: "Hirewise review", CLIENT_CONFIRMATION: "Your confirmation", CANDIDATE_CONFIRMATION: "Candidate confirmation", SCHEDULED: "Scheduled", COMPLETED: "Interviews done", CLIENT_DECISION_PENDING: "Your decision", CLOSED: "Closed" };

function fmt(d: Date | string, tz: string) {
  return new Date(d).toLocaleString("en-US", { timeZone: tz, dateStyle: "medium", timeStyle: "short" });
}

export default async function InterviewRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  if (!["CLIENT", "AGENT"].includes(actor.role)) redirect(`/staff/interviews/${(await params).id}`);
  const { id } = await params;
  let data: Awaited<ReturnType<typeof getRequest>>;
  try {
    data = await getRequest(prisma, actor, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const messages = await listMessages(prisma, actor, id);
  const closed = ["CLOSED", "CANCELLED"].includes(data.request.status);
  const stepIdx = STEPS.indexOf(data.request.status);

  const progress = data.request.status === "CANCELLED" ? null : (
    <ol className="mb-6 flex flex-wrap gap-1.5">
      {STEPS.map((s, i) => (
        <li key={s} className={`rounded-full px-3 py-1 text-[12px] font-semibold ${i < stepIdx ? "bg-brand-50 text-brand-700" : i === stepIdx ? "bg-ink-900 text-white" : "bg-ink-100 text-ink-400"}`}>{STEP_LABEL[s]}</li>
      ))}
    </ol>
  );

  if (data.audience === "AGENT") {
    const r = data.request as Extract<typeof data, { audience: "AGENT" }>["request"];
    return (
      <>
        <Link href="/interviews" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> All interview requests</Link>
        <PageHeader eyebrow="Interview request" title={r.companyName ? `${r.role} at ${r.companyName}` : r.role} description={r.companyName ? "The interview is scheduled; details below." : "The client company is shared once the interview is scheduled. Hirewise coordinates times."} actions={<StatusBadge status={r.status} />} />
        {progress}
        <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
          <div className="space-y-5">
            <Card title="Role">
              <dl className="grid gap-3 text-[14px] sm:grid-cols-2">
                <Item k="Role" v={r.role} /><Item k="Schedule" v={r.schedule ?? "TBD"} /><Item k="Client timezone" v={r.timezone} /><Item k="Target start" v={r.targetStartDate ? new Date(r.targetStartDate).toLocaleDateString() : "TBD"} /><Item k="Your response" v={labelFor(r.myStatus)} />
              </dl>
              {r.status === "CANDIDATE_CONFIRMATION" && r.myStatus === "PENDING" && <div className="mt-4"><CandidateRespond requestId={r.id} /></div>}
            </Card>
            <Card title="Your interviews">
              {r.interviews.length === 0 ? <EmptyState title="Not scheduled yet" /> : (
                <ul className="space-y-3">
                  {r.interviews.map((i) => (
                    <li key={i.id} className="rounded-2xl border border-ink-100 p-4">
                      <div className="flex items-center justify-between"><p className="text-[14.5px] font-semibold">Round {i.round} · {fmt(i.scheduledAt, i.timezone)} ({i.timezone})</p><StatusBadge status={i.status} /></div>
                      <p className="text-[13px] text-ink-500">{i.durationMin} minutes{i.outcome ? ` · outcome: ${labelFor(i.outcome)}` : ""}</p>
                      {i.meetingLink && i.status === "SCHEDULED" && <a href={i.meetingLink} target="_blank" rel="noopener" className="mt-2 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-brand-600"><Video className="h-4 w-4" /> Join meeting</a>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
          <Card title="Messages with Hirewise"><MessageThread requestId={r.id} messages={messages} audience="AGENT" closed={closed} /></Card>
        </div>
      </>
    );
  }

  const r = data.request as Extract<typeof data, { audience: "CLIENT" }>["request"];
  return (
    <>
      <Link href="/interviews" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> All interview requests</Link>
      <PageHeader eyebrow="Interview request" title={r.role} description={`${r.candidates.length} candidate(s) · ${r.accountManagerAssigned ? "coordinated by your account manager" : "awaiting Hirewise assignment"}`} actions={<StatusBadge status={r.status} />} />
      {r.status === "CANCELLED" && <div className="mb-6"><Banner tone="danger" title="Cancelled">{r.cancelledReason}</Banner></div>}
      {r.status === "CLIENT_CONFIRMATION" && <div className="mb-6"><Banner tone="warn" title="Hirewise proposed times">Read the message from your account manager, then confirm below or reply with alternatives.</Banner></div>}
      {r.status === "CLIENT_DECISION_PENDING" && <div className="mb-6"><Banner tone="success" title="Interviews complete">Record a decision for each candidate. Selecting a candidate creates a placement; Hirewise then confirms commercial terms with you.</Banner></div>}
      {progress}
      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-5">
          <Card title="Candidates and interviews">
            <ul className="space-y-3">
              {r.candidates.map((c) => {
                const ivs = r.interviews.filter((i) => i.agentProfileId === c.agentProfileId);
                return (
                  <li key={c.agentProfileId} className="rounded-2xl border border-ink-100 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div><Link href={`/talent/${c.agentProfileId}`} className="text-[15px] font-semibold text-ink-900 hover:text-brand-700">{c.displayName}</Link><p className="text-[12.5px] text-ink-400">{c.primaryRole ?? "—"} · {labelFor(c.status)}</p></div>
                    </div>
                    {ivs.map((i) => (
                      <div key={i.id} className="mt-3 rounded-xl bg-ink-50 p-3">
                        <div className="flex items-center justify-between"><p className="text-[13.5px] font-semibold">Round {i.round} · {fmt(i.scheduledAt, i.timezone)} ({i.timezone})</p><StatusBadge status={i.status} /></div>
                        {i.meetingLink && i.status === "SCHEDULED" && <a href={i.meetingLink} target="_blank" rel="noopener" className="mt-1 inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand-600"><Video className="h-3.5 w-3.5" /> Join meeting</a>}
                        {i.clientDecision !== "NONE" && <p className="mt-1 text-[13px] text-ink-600">Your decision: <span className="font-semibold">{labelFor(i.clientDecision)}</span>{i.clientFeedback ? ` · ${i.clientFeedback}` : ""}</p>}
                        {r.status === "CLIENT_DECISION_PENDING" && i.status === "COMPLETED" && (i.clientDecision === "NONE" || i.clientDecision === "INTERESTED") && <div className="mt-3"><DecisionForm requestId={r.id} interviewId={i.id} displayName={c.displayName} /></div>}
                      </div>
                    ))}
                  </li>
                );
              })}
            </ul>
          </Card>
          <Card title="Your request">
            <dl className="grid gap-3 text-[14px] sm:grid-cols-2">
              <Item k="Schedule" v={r.schedule ?? "TBD"} /><Item k="Timezone" v={r.timezone} /><Item k="Preferred" v={`${r.preferredDate ? new Date(r.preferredDate).toLocaleDateString() : "any date"}${r.preferredTime ? ` · ${r.preferredTime}` : ""}`} /><Item k="Target start" v={r.targetStartDate ? new Date(r.targetStartDate).toLocaleDateString() : "TBD"} />
              {r.notes && <div className="sm:col-span-2"><Item k="Notes" v={r.notes} /></div>}
            </dl>
            {r.status === "CLIENT_CONFIRMATION" && <div className="mt-4"><WorkflowButton requestId={r.id} op="CLIENT_CONFIRM" label="Confirm proposed times" variant="primary" withMessage="Optional note to Hirewise (e.g. which slot you prefer)" /></div>}
            {!closed && !["COMPLETED", "CLIENT_DECISION_PENDING"].includes(r.status) && <div className="mt-4"><WorkflowButton requestId={r.id} op="CANCEL" label="Cancel request" variant="outline" withReason /></div>}
          </Card>
        </div>
        <Card title="Messages with Hirewise"><MessageThread requestId={r.id} messages={messages} audience="CLIENT" closed={closed} /></Card>
      </div>
    </>
  );
}

function Item({ k, v }: { k: string; v: string }) {
  return (<div><dt className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">{k}</dt><dd className="mt-0.5 font-medium break-words text-ink-800">{v}</dd></div>);
}
