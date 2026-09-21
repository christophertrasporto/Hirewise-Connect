import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { listAgentsForStaff } from "@/server/services/agent.service";
import { PageHeader, Card, StatusBadge, EmptyState, fmtDate } from "@/components/app/ui";
import { cn } from "@/lib/cn";
import type { AgentProfileStatus } from "@/server/state/agent-profile";

export const metadata: Metadata = { title: "Talent" };

const FILTERS: Array<{ value: AgentProfileStatus | ""; label: string }> = [
  { value: "", label: "All" },
  { value: "SUBMITTED", label: "Submitted" },
  { value: "UNDER_REVIEW", label: "Under review" },
  { value: "REVISION_REQUIRED", label: "Revision" },
  { value: "APPROVED", label: "Approved" },
  { value: "DRAFT", label: "Draft" },
  { value: "REJECTED", label: "Rejected" },
  { value: "HIDDEN", label: "Hidden" },
  { value: "SUSPENDED", label: "Suspended" },
];

export default async function StaffTalentPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const actor = await requireActor();
  const { status } = await searchParams;
  const filter = (FILTERS.find((f) => f.value === status)?.value ?? "") as AgentProfileStatus | "";
  const rows = await listAgentsForStaff(prisma, actor, filter || undefined);

  return (
    <>
      <PageHeader eyebrow="Talent" title="Talent pipeline" description="Submitted profiles are reviewed by Recruiters, approved by Admins. Only approved profiles are visible to clients." />
      <div className="mb-5 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <Link key={f.value} href={f.value ? `/staff/talent?status=${f.value}` : "/staff/talent"} className={cn("rounded-full px-3.5 py-1.5 text-[13px] font-semibold", filter === f.value ? "bg-ink-900 text-white" : "bg-white text-ink-600 ring-1 ring-inset ring-ink-200 hover:bg-ink-50")}>
            {f.label}
          </Link>
        ))}
      </div>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No profiles match this filter" />
        ) : (
          <table className="w-full text-left text-[14px]">
            <thead className="text-[12px] uppercase tracking-[0.12em] text-ink-400">
              <tr>
                <th className="pb-3 font-semibold">Agent</th>
                <th className="pb-3 font-semibold">Role</th>
                <th className="hidden pb-3 font-semibold md:table-cell">Skills</th>
                <th className="pb-3 font-semibold">Completion</th>
                <th className="pb-3 font-semibold">Status</th>
                <th className="hidden pb-3 font-semibold sm:table-cell">Submitted</th>
                <th className="pb-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className="py-3">
                    <p className="font-semibold text-ink-900">{a.displayName}</p>
                    <p className="text-[12.5px] text-ink-400">{a.email}</p>
                  </td>
                  <td className="py-3 text-ink-700">{a.primaryRole ?? "—"}</td>
                  <td className="hidden py-3 text-[13px] text-ink-500 md:table-cell">{a.skills.slice(0, 4).join(", ")}{a.skills.length > 4 ? ` +${a.skills.length - 4}` : ""}</td>
                  <td className="py-3 tabular-nums text-ink-700">{a.profileCompletion}%</td>
                  <td className="py-3"><StatusBadge status={a.status} /></td>
                  <td className="hidden py-3 text-ink-500 sm:table-cell">{fmtDate(a.submittedAt)}</td>
                  <td className="py-3 text-right">
                    <Link href={`/staff/talent/${a.id}`} className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand-600 hover:text-brand-700">Open <ArrowRight className="h-3.5 w-3.5" /></Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
