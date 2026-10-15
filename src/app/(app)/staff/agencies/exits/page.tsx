import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { exitRequestsForStaff } from "@/server/services/exit.service";
import { ForbiddenError } from "@/server/policies/authorize";
import { PageHeader, Card, Banner, EmptyState, StatusBadge, StatTile } from "@/components/app/ui";
import { ExitDecisionForm, ExitRequestSummary } from "@/components/agency/ExitForms";

export const metadata: Metadata = { title: "Exit requests" };

const STATUSES = ["PENDING_ADMIN", "PENDING_AGENCY", "APPROVED", "DECLINED", "CANCELLED", "COMPLETED"] as const;

/** v2 phase 3: the Hirewise queue for exits that need its review, plus everything else for reference. */
export default async function ExitQueuePage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const status = (STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as (typeof STATUSES)[number]) : "PENDING_ADMIN";
  let data: Awaited<ReturnType<typeof exitRequestsForStaff>>;
  try {
    data = await exitRequestsForStaff(prisma, actor, status);
  } catch (e) {
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="No access">Exit requests are for Hirewise staff with agency permissions.</Banner>;
    throw e;
  }
  const canDecide = actor.permissions.has("agency.manage");
  return (
    <>
      <Link href="/staff/agencies?tab=agencies" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> Agencies</Link>
      <PageHeader eyebrow="Hirewise admin" title="Exit requests" description="Agents ask to leave and agencies ask to remove; Hirewise decides when the agent has an active client assignment, when the agency does not respond in time, or when the setting says so. Nothing ends without a reason on record." />
      <div className="mb-5 grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {STATUSES.map((s) => <StatTile key={s} label={s.toLowerCase().replace(/_/g, " ")} value={data.counts[s] ?? 0} href={`/staff/agencies/exits?status=${s}`} />)}
      </div>
      {data.rows.length === 0 ? <Card><EmptyState title={`No ${status.toLowerCase().replace(/_/g, " ")} requests`} /></Card> : (
        <div className="space-y-4">
          {data.rows.map((r) => (
            <Card key={r.id} title={<span><Link href={`/staff/agencies/${r.agencyId}`} className="hover:text-brand-700">{r.agencyName}</Link> · <Link href={`/staff/talent/${r.agentProfileId}`} className="hover:text-brand-700">{r.displayName}</Link></span>} actions={<StatusBadge status={r.status} />}>
              <ExitRequestSummary r={r} audience="STAFF" />
              {r.status === "PENDING_ADMIN" && canDecide && <div className="mt-4"><ExitDecisionForm request={r} audience="STAFF" /></div>}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
