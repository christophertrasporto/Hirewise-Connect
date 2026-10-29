import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { authorize } from "@/server/policies/authorize";
import { listWithdrawalQueue } from "@/server/services/wallet.service";
import { Card, EmptyState, StatusBadge, fmtDate } from "@/components/app/ui";
import { WithdrawalDecisionForm } from "@/components/wallet/StaffWalletForms";

export const metadata: Metadata = { title: "Coach withdrawals" };

const GROUPS = { open: ["REQUESTED", "APPROVED"], PAID: ["PAID"], REJECTED: ["REJECTED"] } as const;
const LABEL = { open: "Open requests", PAID: "Paid", REJECTED: "Rejected" } as const;

export default async function StaffWithdrawalsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const actor = await requireActor();
  authorize(actor, "wallet.manage");
  const sp = await searchParams;
  const show = sp.show === "PAID" || sp.show === "REJECTED" ? sp.show : "open";
  const rows = await listWithdrawalQueue(prisma, actor, [...GROUPS[show]]);
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        {(["open", "PAID", "REJECTED"] as const).map((g) => (
          <Link key={g} href={`/staff/wallet?show=${g}`} className={`rounded-full border px-3.5 py-1 text-[13px] font-semibold ${show === g ? "border-ink-900 bg-ink-900 text-white" : "border-ink-200 bg-white text-ink-700 hover:bg-ink-50"}`}>
            {LABEL[g]}
          </Link>
        ))}
      </div>
      {rows.length === 0 ? (
        <Card>
          <EmptyState title={`No ${LABEL[show].toLowerCase()}`} />
        </Card>
      ) : (
        <div className="space-y-4">
          {rows.map((w) => (
            <Card
              key={w.id}
              title={<span>{w.label} · <Link href={`/staff/wallet/coaches/${w.coachUserId}`} className="hover:text-brand-700">{w.coachEmail}</Link></span>}
              description={`Requested ${fmtDate(w.requestedAt)} · ${w.status.toLowerCase()}${w.reference ? ` · reference ${w.reference}` : ""}${w.rejectionReason ? ` · ${w.rejectionReason}` : ""}`}
              actions={<StatusBadge status={w.status === "PAID" ? "APPROVED" : w.status} />}
            >
              <dl className="mb-4 grid gap-x-6 gap-y-1 text-[13.5px] sm:grid-cols-3">
                <div>
                  <dt className="text-[11.5px] tracking-[0.1em] text-ink-400 uppercase">Method</dt>
                  <dd className="font-medium text-ink-900">{w.account_details.method === "GCASH" ? "GCash" : w.account_details.method === "MAYA" ? "Maya" : `Bank transfer${w.account_details.bankName ? ` · ${w.account_details.bankName}` : ""}`}</dd>
                </div>
                <div>
                  <dt className="text-[11.5px] tracking-[0.1em] text-ink-400 uppercase">Account name</dt>
                  <dd className="font-medium text-ink-900">{w.account_details.accountName}</dd>
                </div>
                <div>
                  <dt className="text-[11.5px] tracking-[0.1em] text-ink-400 uppercase">Account number</dt>
                  <dd className="font-mono font-medium text-ink-900">{w.account_details.accountNumber}</dd>
                </div>
              </dl>
              {(w.status === "REQUESTED" || w.status === "APPROVED") && <WithdrawalDecisionForm withdrawalId={w.id} status={w.status} />}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
