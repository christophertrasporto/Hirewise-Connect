import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { authorize } from "@/server/policies/authorize";
import { listPayoutQueue } from "@/server/services/payout.service";
import { formatMoney } from "@/server/views/seat.views";
import { Card, EmptyState, StatusBadge, fmtDate } from "@/components/app/ui";
import { PayoutDecisionForm } from "@/components/referral/StaffForms";

export const metadata: Metadata = { title: "Referral payouts" };

export default async function StaffPayoutsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const actor = await requireActor();
  authorize(actor, "payout.manage");
  const sp = await searchParams;
  const statuses = ["REQUESTED", "APPROVED", "PAID", "REJECTED"] as const;
  const status = statuses.find((s) => s === sp.status) ?? "REQUESTED";
  const rows = await listPayoutQueue(prisma, actor, status);
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        {statuses.map((s) => <Link key={s} href={`/staff/referrals/payouts?status=${s}`} className={`rounded-full border px-3.5 py-1 text-[13px] font-semibold ${status === s ? "border-ink-900 bg-ink-900 text-white" : "border-ink-200 bg-white text-ink-700 hover:bg-ink-50"}`}>{s.charAt(0) + s.slice(1).toLowerCase()}</Link>)}
      </div>
      {rows.length === 0 ? <Card><EmptyState title={`No ${status.toLowerCase()} payouts`} /></Card> : (
        <div className="space-y-4">
          {rows.map((p) => (
            <Card key={p.id} title={<span>{formatMoney(p.amount, p.currency)} · <Link href={`/staff/referrals/${p.referrerId}`} className="hover:text-brand-700">{p.referrer}</Link></span>} description={`Requested ${fmtDate(p.requestedAt)}${p.paidAt ? ` · paid ${fmtDate(p.paidAt)}` : ""}${p.reference ? ` · ref ${p.reference}` : ""}${p.rejectReason ? ` · ${p.rejectReason}` : ""}`} actions={<StatusBadge status={p.status} />}>
              {p.account ? (
                <dl className="mb-4 grid gap-x-6 gap-y-1 text-[13.5px] sm:grid-cols-3">
                  <div><dt className="text-[11.5px] tracking-[0.1em] text-ink-400 uppercase">Method</dt><dd className="font-medium text-ink-900">{p.account.method === "GCASH" ? "GCash" : `Bank transfer${p.account.bankName ? ` · ${p.account.bankName}` : ""}`}</dd></div>
                  <div><dt className="text-[11.5px] tracking-[0.1em] text-ink-400 uppercase">Account name</dt><dd className="font-medium text-ink-900">{p.account.accountName}</dd></div>
                  <div><dt className="text-[11.5px] tracking-[0.1em] text-ink-400 uppercase">Account number</dt><dd className="font-mono font-medium text-ink-900">{p.account.accountNumber}</dd></div>
                </dl>
              ) : <p className="mb-4 text-[13px] text-ink-500">{p.accountLabel}</p>}
              {(p.status === "REQUESTED" || p.status === "APPROVED") && <PayoutDecisionForm payoutId={p.id} status={p.status} />}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
