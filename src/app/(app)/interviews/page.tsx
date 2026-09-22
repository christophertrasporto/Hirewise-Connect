import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarPlus } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { listRequestsForClient, listRequestsForAgent } from "@/server/services/interview.service";
import { PageHeader, Card, StatusBadge, EmptyState, fmtDate } from "@/components/app/ui";
import { labelFor } from "@/lib/options";

export const metadata: Metadata = { title: "Interviews" };

export default async function InterviewsPage() {
  const actor = await requireActor();
  if (actor.role === "AGENT") {
    const rows = await listRequestsForAgent(prisma, actor);
    return (
      <>
        <PageHeader eyebrow="Interviews" title="Your interview requests" description="Clients request interviews through Hirewise. Confirm your availability here; the company is shared once an interview is scheduled." />
        <Card>
          {rows.length === 0 ? <EmptyState title="No interview requests yet" description="Keep your profile and availability current." /> : (
            <ul className="divide-y divide-ink-100">
              {rows.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="text-[15px] font-semibold text-ink-900">{r.role}{r.companyName ? ` · ${r.companyName}` : " · company shared at scheduling"}</p>
                    <p className="text-[12.5px] text-ink-400">{r.schedule ?? "Schedule TBD"} · {r.timezone} · requested {fmtDate(r.createdAt)} · your status: {r.myStatus.toLowerCase()}</p>
                  </div>
                  <div className="flex items-center gap-3"><StatusBadge status={r.status} /><Link href={`/interviews/${r.id}`} className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand-600">Open <ArrowRight className="h-3.5 w-3.5" /></Link></div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </>
    );
  }
  const rows = await listRequestsForClient(prisma, actor);
  return (
    <>
      <PageHeader eyebrow="Interviews" title="Interview requests" description="Every request moves through Hirewise: review, time proposal, candidate confirmation, scheduling, then your decision." actions={<Link href="/interviews/new" className="inline-flex h-11 items-center gap-2 rounded-full bg-ink-900 px-5 text-[14.5px] font-semibold text-white hover:bg-ink-800"><CalendarPlus className="h-4 w-4" /> Request interviews</Link>} />
      <Card>
        {rows.length === 0 ? <EmptyState title="No interview requests yet" description="Shortlist candidates, then request interviews." /> : (
          <ul className="divide-y divide-ink-100">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-4 py-3">
                <div>
                  <p className="text-[15px] font-semibold text-ink-900">{r.role} · {r.candidates.map((c) => c.displayName).join(", ")}</p>
                  <p className="text-[12.5px] text-ink-400">Requested {fmtDate(r.createdAt)} · {r.interviews.length} interview(s) · {labelFor(r.status)}</p>
                </div>
                <div className="flex items-center gap-3"><StatusBadge status={r.status} /><Link href={`/interviews/${r.id}`} className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand-600">Open <ArrowRight className="h-3.5 w-3.5" /></Link></div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
