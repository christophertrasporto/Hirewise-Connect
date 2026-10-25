import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { authorize, NotFoundError } from "@/server/policies/authorize";
import { affiliateDetail } from "@/server/services/referral-admin.service";
import { formatMoney } from "@/server/views/seat.views";
import { rateLabel } from "@/lib/referral";
import { Card, EmptyState, StatTile, StatusBadge, fmtDate } from "@/components/app/ui";
import { AdjustBalanceForm, ReverseCommissionForm, ReviewFlagButton } from "@/components/referral/StaffForms";

export const metadata: Metadata = { title: "Affiliate" };

export default async function AffiliatePage({ params }: { params: Promise<{ userId: string }> }) {
  const actor = await requireActor();
  authorize(actor, "referral.manage");
  const { userId } = await params;
  let d: Awaited<ReturnType<typeof affiliateDetail>>;
  try {
    d = await affiliateDetail(prisma, actor, userId);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const m = (n: number, c = d.currency) => formatMoney(n, c);
  const openFlags = d.flags.filter((f) => !f.reviewed);
  return (
    <>
      <Link href="/staff/referrals" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> Affiliates</Link>
      <h2 className="font-display text-[22px] font-bold text-ink-900">{d.user.name ?? d.user.email}</h2>
      <p className="mb-5 text-[13.5px] text-ink-500">{d.user.email} · {d.user.role.toLowerCase().replace(/_/g, " ")} · code {d.user.code ?? "not created yet"}</p>
      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <StatTile label="On hold" value={m(d.balance.onHold)} />
        <StatTile label="Payable" value={m(d.balance.payable)} hint={d.balance.adjustments !== 0 ? `includes ${m(d.balance.adjustments)} adjustments` : undefined} />
        <StatTile label="Paid out" value={m(d.balance.paid)} />
        <StatTile label="Referred sign-ups" value={d.referred.length} />
      </div>

      {openFlags.length > 0 && (
        <Card title={`Fraud flags (${openFlags.length})`} description="Flags never block anything by themselves; decide whether the pattern is real before paying out.">
          <ul className="divide-y divide-ink-100">
            {openFlags.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[13.5px]">
                <span><span className="font-semibold text-ink-900">{f.kind.toLowerCase().replace(/_/g, " ")}</span> · referred {f.referredEmail}<span className="block text-[12.5px] text-ink-500">{f.detail}</span></span>
                <ReviewFlagButton flagId={f.id} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mt-5 space-y-5">
        <Card title="Commissions" description="Reverse one manually if a sale should not earn. A note is required and goes to the audit log.">
          {d.commissions.length === 0 ? <EmptyState title="No commissions" /> : (
            <div className="-mx-2 overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-[13.5px]">
                <thead className="text-[11.5px] tracking-[0.1em] text-ink-400 uppercase"><tr><th className="px-2 py-2 font-semibold">Buyer</th><th className="px-2 py-2 font-semibold">Course</th><th className="px-2 py-2 text-right font-semibold">Sale</th><th className="px-2 py-2 text-right font-semibold">Rate</th><th className="px-2 py-2 text-right font-semibold">Commission</th><th className="px-2 py-2 font-semibold">Status</th><th className="px-2 py-2 font-semibold">Action</th></tr></thead>
                <tbody className="divide-y divide-ink-100">
                  {d.commissions.map((c) => (
                    <tr key={c.id}>
                      <td className="px-2 py-2.5">{c.buyerEmail}<span className="block text-[12px] text-ink-400">{fmtDate(c.createdAt)}</span></td>
                      <td className="px-2 py-2.5">{c.course}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{m(c.sale, c.currency)}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{rateLabel(c.rateBps)}</td>
                      <td className="px-2 py-2.5 text-right font-semibold tabular-nums">{m(c.commission, c.currency)}</td>
                      <td className="px-2 py-2.5"><StatusBadge status={c.status} />{c.status === "ON_HOLD" && <span className="block text-[12px] text-ink-400">until {fmtDate(c.availableAt)}</span>}{c.reversedReason && <span className="block text-[12px] text-ink-400">{c.reversedReason}</span>}</td>
                      <td className="px-2 py-2.5">{c.status !== "REVERSED" ? <ReverseCommissionForm commissionId={c.id} /> : <span className="text-ink-300">Reversed</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Adjust balance" description="A signed change (use a minus sign to deduct), with a required note. The member is notified and sees the note.">
          <AdjustBalanceForm referrerId={d.user.id} currency={d.currency} />
          {d.adjustments.length > 0 && (
            <ul className="mt-4 divide-y divide-ink-100 text-[13px]">
              {d.adjustments.map((a) => <li key={a.id} className="flex flex-wrap justify-between gap-2 py-2"><span><span className="font-semibold tabular-nums">{a.amount < 0 ? "-" : "+"}{m(Math.abs(a.amount), a.currency)}</span> <span className="text-ink-500">· {a.kind.toLowerCase().replace(/_/g, " ")} · {a.note}</span></span><span className="text-ink-400">{fmtDate(a.createdAt)}{a.settled ? " · settled" : ""}</span></li>)}
            </ul>
          )}
        </Card>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card title={`Payouts (${d.payouts.length})`}>
            {d.payouts.length === 0 ? <EmptyState title="No payouts" /> : <ul className="divide-y divide-ink-100 text-[13.5px]">{d.payouts.map((p) => <li key={p.id} className="flex items-center justify-between gap-2 py-2"><span className="tabular-nums">{m(p.amount, p.currency)} <span className="text-ink-400">· {fmtDate(p.requestedAt)}{p.reference ? ` · ref ${p.reference}` : ""}</span></span><StatusBadge status={p.status} /></li>)}</ul>}
          </Card>
          <Card title={`Referred members (${d.referred.length})`}>
            {d.referred.length === 0 ? <EmptyState title="No sign-ups yet" /> : <ul className="divide-y divide-ink-100 text-[13.5px]">{d.referred.map((r) => <li key={r.id} className="flex items-center justify-between gap-2 py-2"><span>{r.email}</span><span className="text-ink-400">{fmtDate(r.at)}</span></li>)}</ul>}
          </Card>
        </div>
      </div>
    </>
  );
}
