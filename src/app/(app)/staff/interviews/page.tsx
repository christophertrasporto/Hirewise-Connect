import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { listRequestsForStaff, upcomingInterviewsForStaff } from "@/server/services/interview.service";
import { PageHeader, Card, StatusBadge, EmptyState, fmtDate } from "@/components/app/ui";
import { cn } from "@/lib/cn";
import type { InterviewRequestStatus } from "@/server/state/interview-request";

export const metadata: Metadata = { title: "Interview requests" };

const FILTERS: Array<{ value: string; label: string }> = [
  { value: "open", label: "Open" }, { value: "mine", label: "Assigned to me" }, { value: "REQUESTED", label: "New" }, { value: "CLIENT_CONFIRMATION", label: "Awaiting client" }, { value: "CANDIDATE_CONFIRMATION", label: "Awaiting candidates" }, { value: "SCHEDULED", label: "Scheduled" }, { value: "CLIENT_DECISION_PENDING", label: "Awaiting decision" }, { value: "all", label: "All" },
];

export default async function StaffInterviewsPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const actor = await requireActor();
  const { f } = await searchParams;
  const filter = (FILTERS.some((x) => x.value === f) ? f : "open") as "open" | "mine" | "all" | InterviewRequestStatus;
  const [rows, upcoming] = await Promise.all([listRequestsForStaff(prisma, actor, filter), upcomingInterviewsForStaff(prisma, actor)]);
  return (
    <>
      <PageHeader eyebrow="Sales" title="Interview requests" description="Every request moves Requested → Sales review → Client confirmation → Candidate confirmation → Scheduled → Decision. Candidates never see the client until scheduling." />
      <div className="mb-5 flex flex-wrap gap-1.5">
        {FILTERS.map((x) => <Link key={x.value} href={`/staff/interviews?f=${x.value}`} className={cn("rounded-full px-3.5 py-1.5 text-[13px] font-semibold", filter === x.value ? "bg-ink-900 text-white" : "bg-white text-ink-600 ring-1 ring-inset ring-ink-200 hover:bg-ink-50")}>{x.label}</Link>)}
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.4fr_0.6fr]">
        <Card>
          {rows.length === 0 ? <EmptyState title="No requests match this filter" /> : (
            <ul className="divide-y divide-ink-100">
              {rows.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="text-[15px] font-semibold text-ink-900">{r.client.companyName} · {r.role}</p>
                    <p className="text-[12.5px] text-ink-400">{r.candidates.map((c) => `${c.displayName} (${c.status.toLowerCase()})`).join(", ")} · requested {fmtDate(r.createdAt)} · {r.assignedSales ? r.assignedSales.email : "unassigned"}</p>
                  </div>
                  <div className="flex items-center gap-3"><StatusBadge status={r.status} /><Link href={`/staff/interviews/${r.id}`} className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand-600">Open <ArrowRight className="h-3.5 w-3.5" /></Link></div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Next 7 days">
          {upcoming.length === 0 ? <EmptyState title="No interviews scheduled" /> : (
            <ul className="divide-y divide-ink-100 text-[13.5px]">
              {upcoming.map((i) => (
                <li key={i.id} className="py-2.5">
                  <p className="font-semibold text-ink-800">{i.displayName} × {i.companyName}</p>
                  <p className="text-ink-500">{new Date(i.scheduledAt).toLocaleString("en-US", { timeZone: i.timezone, dateStyle: "medium", timeStyle: "short" })} ({i.timezone}) · <Link href={`/staff/interviews/${i.requestId}`} className="font-semibold text-brand-600">open</Link></p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
