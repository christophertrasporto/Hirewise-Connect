import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { listPendingBillingRates } from "@/server/services/rate.service";
import { ForbiddenError } from "@/server/policies/authorize";
import { Card, EmptyState, Banner, fmtDate } from "@/components/app/ui";
import { RateDecision } from "@/components/commercial/RateForms";
import { rateLabel } from "@/server/views/commercial.views";

export const metadata: Metadata = { title: "Rate approvals" };

export default async function RateApprovalsPage() {
  const actor = await requireActor();
  let pending: Awaited<ReturnType<typeof listPendingBillingRates>>;
  try {
    pending = await listPendingBillingRates(prisma, actor);
  } catch (e) {
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="Publishing requires billing_rate.approve">Sales proposes rates from an agent&apos;s profile; Admin publishes them here.</Banner>;
    throw e;
  }
  return (
    <Card title="Pending client rate proposals" description="Publishing retires the previous published rate and writes a RateHistory row. Clients see PUBLISHED rates only.">
      {pending.length === 0 ? <EmptyState title="Nothing to approve" /> : (
        <ul className="divide-y divide-ink-100">
          {pending.map((r) => (
            <li key={r.id} className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-[15px] font-semibold text-ink-900"><Link href={`/staff/talent/${r.agentProfile.id}`} className="hover:text-brand-700">{r.agentProfile.displayName}</Link> <span className="font-normal text-ink-400">· {r.agentProfile.primaryRole ?? "Talent"}</span></p>
                <p className="text-[13px] text-ink-600"><span className="font-semibold">{rateLabel(r)}</span> · proposed by {r.proposedBy.email} on {fmtDate(r.createdAt)}</p>
                {r.positioningNotes && <p className="mt-1 text-[12.5px] text-ink-500">Notes: {r.positioningNotes}</p>}
              </div>
              <RateDecision rateId={r.id} mode="PENDING" />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
