import type { Metadata } from "next";
import Link from "next/link";
import { Fragment } from "react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { authorize } from "@/server/policies/authorize";
import { myWallet, WALLET_CURRENCY } from "@/server/services/wallet.service";
import { formatMoney } from "@/server/views/seat.views";
import { Banner, Card, EmptyState, PageHeader, StatTile, StatusBadge, fmtDate } from "@/components/app/ui";
import { PayoutDetailsForm, WithdrawButton } from "@/components/wallet/WalletForms";

export const metadata: Metadata = { title: "Wallet" };

const money = (minor: number) => formatMoney(minor, WALLET_CURRENCY);
const STATUS_LABEL: Record<string, string> = { PENDING_FEE: "Waiting for the gateway fee", ON_HOLD: "On hold", AVAILABLE: "Available", WITHDRAWN: "Withdrawn", REVERSED: "Refunded" };

export default async function CoachWalletPage({ searchParams }: { searchParams: Promise<{ course?: string; from?: string; to?: string }> }) {
  const actor = await requireActor();
  authorize(actor, "coach.wallet");
  const sp = await searchParams;
  const filters = { courseId: sp.course || undefined, from: sp.from || undefined, to: sp.to || undefined };
  let w: Awaited<ReturnType<typeof myWallet>>;
  let badFilter = false;
  try {
    w = await myWallet(prisma, actor, filters);
  } catch {
    badFilter = true;
    w = await myWallet(prisma, actor);
  }
  const b = w.balance;
  const open = w.withdrawals.some((x) => x.status === "REQUESTED" || x.status === "APPROVED");
  const disabledReason = !w.payoutDetails ? "Add your payout details below first." : open ? "You have a withdrawal in progress." : b.withdrawable < w.minimumWithdrawalMinor || b.withdrawable <= 0 ? `The minimum withdrawal is ${money(w.minimumWithdrawalMinor)}.` : null;
  const query = new URLSearchParams(Object.entries({ course: sp.course, from: sp.from, to: sp.to }).filter(([, v]) => !!v) as Array<[string, string]>).toString();

  return (
    <>
      <PageHeader eyebrow="Coach" title="Wallet" description="What your courses have earned, when it becomes available, and your withdrawals. Your share is calculated from the net of each sale: the price the buyer paid minus the payment gateway's fee." />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="On hold" value={money(b.onHold)} hint={b.nextAvailableAt ? `Next ${fmtDate(b.nextAvailableAt)}` : "Nothing on hold"} />
        <StatTile label="Available to withdraw" value={money(b.withdrawable)} hint={b.available < 0 ? `Balance is ${money(b.available)}: a refund after a withdrawal. New earnings repay it first.` : `Minimum ${money(w.minimumWithdrawalMinor)}`} />
        <StatTile label="Withdrawn (all time)" value={money(b.withdrawn)} />
      </div>
      {b.pendingFeeCount > 0 && <div className="mt-4"><Banner tone="info" title={`${b.pendingFeeCount} sale${b.pendingFeeCount === 1 ? " is" : "s are"} waiting for the gateway fee`}>Online payments are counted once Hirewise has the exact fee from the payment gateway. These sales ({money(b.pendingFeeSaleMinor)} in total) will show your earning and go on hold as soon as it is recorded.</Banner></div>}

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_1fr]">
        <Card title="Withdraw" description="You withdraw your whole available balance. Hirewise reviews each request and sends the money to the account below.">
          <WithdrawButton available={money(b.withdrawable)} disabledReason={disabledReason} />
        </Card>
        <Card title="Payout details" description="One account for all payouts from Hirewise.">
          <PayoutDetailsForm details={w.payoutDetails} />
        </Card>
      </div>

      <div className="mt-6">
        <Card title="Sales" description="Buyers are shown by first name and last initial. Open a sale to see exactly how your earning was calculated.">
          <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
            <label className="text-[12.5px] font-semibold text-ink-600">Course
              <select name="course" defaultValue={sp.course ?? ""} className="mt-1 block h-10 rounded-xl border border-ink-200 bg-white px-3 text-[13.5px] text-ink-800">
                <option value="">All courses</option>
                {w.courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </label>
            <label className="text-[12.5px] font-semibold text-ink-600">From<input type="date" name="from" defaultValue={sp.from ?? ""} className="mt-1 block h-10 rounded-xl border border-ink-200 bg-white px-3 text-[13.5px] text-ink-800" /></label>
            <label className="text-[12.5px] font-semibold text-ink-600">To<input type="date" name="to" defaultValue={sp.to ?? ""} className="mt-1 block h-10 rounded-xl border border-ink-200 bg-white px-3 text-[13.5px] text-ink-800" /></label>
            <button type="submit" className="h-10 rounded-full border border-ink-200 bg-white px-4 text-[13.5px] font-semibold text-ink-800 hover:bg-ink-50">Filter</button>
            {query && <Link href="/wallet" className="h-10 self-center text-[13.5px] font-semibold text-ink-500 hover:text-ink-900">Clear</Link>}
            <a href={`/api/wallet/export${query ? `?${query}` : ""}`} className="ml-auto h-10 self-center text-[13.5px] font-semibold text-brand-700 hover:text-brand-800">Download CSV</a>
          </form>
          {badFilter && <div className="mb-3"><Banner tone="warn" title="That filter was not understood">Showing all sales instead.</Banner></div>}
          {w.sales.length === 0 ? (
            <EmptyState title="No sales yet" description="When someone buys one of your courses it appears here." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-[13.5px]">
                <thead className="text-[11.5px] uppercase tracking-[0.1em] text-ink-400">
                  <tr><th className="py-2 pr-3 font-semibold">Date</th><th className="py-2 pr-3 font-semibold">Buyer</th><th className="py-2 pr-3 font-semibold">Course</th><th className="py-2 pr-3 text-right font-semibold">Sale</th><th className="py-2 pr-3 text-right font-semibold">Gateway fee</th><th className="py-2 pr-3 text-right font-semibold">Your earning</th><th className="py-2 pr-3 font-semibold">Status</th><th className="py-2 font-semibold">Available on</th></tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {w.sales.map((s) => (
                    <Fragment key={s.id}>
                      <tr className="align-top">
                        <td className="py-3 pr-3 whitespace-nowrap text-ink-600">{fmtDate(s.paidAt)}</td>
                        <td className="py-3 pr-3 text-ink-900">{s.buyer}{s.buyerEmail && <span className="block text-[12px] text-ink-400">{s.buyerEmail}</span>}</td>
                        <td className="py-3 pr-3 text-ink-700">{s.courseTitle}</td>
                        <td className="py-3 pr-3 text-right whitespace-nowrap">{s.labels.sale}</td>
                        <td className="py-3 pr-3 text-right whitespace-nowrap">{s.labels.fee ?? "Waiting"}</td>
                        <td className="py-3 pr-3 text-right font-semibold whitespace-nowrap text-ink-900">{s.labels.coach ?? "Waiting"}</td>
                        <td className="py-3 pr-3"><StatusBadge status={s.status === "REVERSED" ? "REJECTED" : s.status} /><span className="mt-1 block text-[12px] text-ink-400">{STATUS_LABEL[s.status]}</span></td>
                        <td className="py-3 whitespace-nowrap text-ink-600">{s.status === "PENDING_FEE" || s.status === "REVERSED" ? "Not applicable" : fmtDate(s.availableAt)}</td>
                      </tr>
                      <tr>
                        <td colSpan={8} className="pb-3">
                          <details className="rounded-xl bg-ink-50 px-4 py-2 text-[13px]">
                            <summary className="cursor-pointer font-semibold text-ink-600">How this was calculated</summary>
                            {s.netAmount === null ? (
                              <p className="mt-2 text-ink-600">The buyer paid {s.labels.sale}. Your earning is worked out once the payment gateway&apos;s exact fee is recorded.</p>
                            ) : (
                              <ol className="mt-2 space-y-1 text-ink-700">
                                <li>The buyer paid <strong>{s.labels.sale}</strong></li>
                                <li>Payment gateway fee: <strong>−{s.labels.fee}</strong></li>
                                <li>Net: <strong>{s.labels.net}</strong></li>
                                <li>Your share ({s.coachRatePercent}% of the net, rounded down): <strong>{s.labels.coach}</strong>{s.refundedSaleMinor > 0 && <span className="text-ink-500"> (after refunds of {formatMoney(s.refundedSaleMinor, s.currency)} on this sale)</span>}</li>
                                <li>Hirewise&apos;s share: <strong>{s.labels.platform}</strong></li>
                              </ol>
                            )}
                          </details>
                        </td>
                      </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <Card title="Withdrawal history">
          {w.withdrawals.length === 0 ? (
            <EmptyState title="No withdrawals yet" />
          ) : (
            <ul className="divide-y divide-ink-100">
              {w.withdrawals.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-[13.5px]">
                  <span><strong className="text-ink-900">{x.label}</strong> <span className="text-ink-500">to {x.account} · requested {fmtDate(x.requestedAt)}</span></span>
                  <span className="text-ink-600"><StatusBadge status={x.status === "PAID" ? "APPROVED" : x.status} /> {x.status === "PAID" && x.reference ? `Reference ${x.reference}` : x.status === "REJECTED" && x.rejectionReason ? x.rejectionReason : x.status.charAt(0) + x.status.slice(1).toLowerCase()}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
