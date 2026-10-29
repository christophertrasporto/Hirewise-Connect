import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { authorize, NotFoundError } from "@/server/policies/authorize";
import { coachWalletDetail, WALLET_CURRENCY } from "@/server/services/wallet.service";
import { formatMoney } from "@/server/views/seat.views";
import { Card, EmptyState, StatTile, StatusBadge, fmtDate } from "@/components/app/ui";
import { AdjustForm, OverrideForm } from "@/components/wallet/StaffWalletForms";

export const metadata: Metadata = { title: "Coach wallet" };
const money = (n: number) => formatMoney(n, WALLET_CURRENCY);

export default async function StaffCoachWalletPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  authorize(actor, "wallet.manage");
  const { id } = await params;
  let d: Awaited<ReturnType<typeof coachWalletDetail>>;
  try {
    d = await coachWalletDetail(prisma, actor, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const b = d.balance;
  return (
    <div className="space-y-5">
      <Link href="/staff/wallet/coaches" className="text-[13.5px] font-medium text-ink-500 hover:text-ink-900">← All coaches</Link>
      <h2 className="font-display text-[1.5rem] font-bold text-ink-900">{d.coach.email}</h2>
      <div className="grid gap-4 sm:grid-cols-4">
        <StatTile label="On hold" value={money(b.onHold)} hint={b.nextAvailableAt ? `Next ${fmtDate(b.nextAvailableAt)}` : undefined} />
        <StatTile label="Available" value={money(b.available)} hint={b.available < 0 ? "Negative after a refund" : undefined} />
        <StatTile label="Withdrawn" value={money(b.withdrawn)} />
        <StatTile label="Waiting for fee" value={b.pendingFeeCount} hint={b.pendingFeeCount ? money(b.pendingFeeSaleMinor) : undefined} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Manual adjustment" description="A signed change to this coach's balance. The note is required and is recorded in the ledger and the audit log.">
          <AdjustForm coachUserId={d.coach.id} />
        </Card>
        <Card title="Special rate" description="Replaces the standard coach share for this coach's new sales only. Sales already made keep the rate they were made at.">
          <OverrideForm coachUserId={d.coach.id} current={d.override ? { percent: d.override.shareBps / 100, note: d.override.note } : null} />
        </Card>
      </div>

      <Card title="Ledger" description="Every change to the balance, newest first. Entries are never edited or deleted.">
        {d.ledger.length === 0 ? <EmptyState title="No entries yet" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[13.5px]">
              <thead className="text-[11.5px] uppercase tracking-[0.1em] text-ink-400"><tr><th className="py-2 pr-3 font-semibold">Date</th><th className="py-2 pr-3 font-semibold">Type</th><th className="py-2 pr-3 text-right font-semibold">Amount</th><th className="py-2 font-semibold">Note</th></tr></thead>
              <tbody className="divide-y divide-ink-100">
                {d.ledger.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2.5 pr-3 whitespace-nowrap text-ink-600">{fmtDate(l.createdAt)}</td>
                    <td className="py-2.5 pr-3 text-ink-800">{l.type.replace(/_/g, " ").toLowerCase()}</td>
                    <td className={`py-2.5 pr-3 text-right font-semibold whitespace-nowrap ${l.amount < 0 ? "text-red-600" : "text-ink-900"}`}>{l.label}</td>
                    <td className="py-2.5 text-ink-600">{l.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Sales" description="Staff see the full breakdown, including the referral commission paid out of the platform share and any gateway fee the platform absorbed on a refund.">
        {d.earnings.length === 0 ? <EmptyState title="No sales yet" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-[13.5px]">
              <thead className="text-[11.5px] uppercase tracking-[0.1em] text-ink-400"><tr><th className="py-2 pr-3 font-semibold">Date</th><th className="py-2 pr-3 font-semibold">Buyer and course</th><th className="py-2 pr-3 text-right font-semibold">Sale</th><th className="py-2 pr-3 text-right font-semibold">Fee</th><th className="py-2 pr-3 text-right font-semibold">Net</th><th className="py-2 pr-3 text-right font-semibold">Coach</th><th className="py-2 pr-3 text-right font-semibold">Platform</th><th className="py-2 pr-3 text-right font-semibold">Affiliate</th><th className="py-2 font-semibold">Status</th></tr></thead>
              <tbody className="divide-y divide-ink-100">
                {d.earnings.map((e) => (
                  <tr key={e.id} className="align-top">
                    <td className="py-2.5 pr-3 whitespace-nowrap text-ink-600">{fmtDate(e.paidAt)}</td>
                    <td className="py-2.5 pr-3 text-ink-800">{e.buyer}<span className="block text-[12px] text-ink-400">{e.courseTitle}</span></td>
                    <td className="py-2.5 pr-3 text-right whitespace-nowrap">{e.labels.sale}</td>
                    <td className="py-2.5 pr-3 text-right whitespace-nowrap">{e.labels.fee ?? "Waiting"}{e.feeAbsorbedMinor > 0 && <span className="block text-[12px] text-red-600">absorbed {money(e.feeAbsorbedMinor)}</span>}</td>
                    <td className="py-2.5 pr-3 text-right whitespace-nowrap">{e.labels.net ?? ""}</td>
                    <td className="py-2.5 pr-3 text-right whitespace-nowrap">{e.labels.coach ?? ""}<span className="block text-[12px] text-ink-400">{e.coachRatePercent}%</span></td>
                    <td className="py-2.5 pr-3 text-right whitespace-nowrap">{e.labels.platform ?? ""}</td>
                    <td className="py-2.5 pr-3 text-right whitespace-nowrap">{e.affiliateAmount ? money(e.affiliateAmount) : ""}</td>
                    <td className="py-2.5"><StatusBadge status={e.status === "REVERSED" ? "REJECTED" : e.status} /><span className="block text-[12px] text-ink-400">{e.status.replace("_", " ").toLowerCase()}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
