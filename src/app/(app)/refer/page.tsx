import type { Metadata } from "next";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { referralOverview, myCommissions, canRefer } from "@/server/services/referral.service";
import { myPayouts, myPayoutDetails } from "@/server/services/payout.service";
import { formatMoney } from "@/server/views/seat.views";
import { PageHeader, Card, StatTile, EmptyState, Banner, StatusBadge, fmtDate } from "@/components/app/ui";
import { ReferralLinkCard, PayoutDetailsForm, RequestPayoutButton } from "@/components/referral/MemberPanels";

export const metadata: Metadata = { title: "Refer & Earn" };

/** Member page: the personal link, the totals, the commission history, and payouts. */
export default async function ReferPage() {
  const actor = await requireActor();
  if (!canRefer(actor)) return <Banner tone="warn" title="Refer & Earn">Referral links are available to talent and agency owners.</Banner>;
  const [o, commissions, payouts, details] = await Promise.all([referralOverview(prisma, actor), myCommissions(prisma, actor), myPayouts(prisma, actor), myPayoutDetails(prisma, actor)]);
  const m = (n: number) => formatMoney(n, o.currency);
  const open = payouts.find((p) => p.status === "REQUESTED" || p.status === "APPROVED");
  const shortfall = Math.max(0, o.minimumPayoutMinor - Math.max(0, o.payable));

  return (
    <>
      <PageHeader eyebrow="Refer & Earn" title="Earn when people you refer buy courses" description={`Share your link. When someone signs up through it, you earn ${o.rateLabel} of every course they buy for as long as their account exists. Commissions are held for ${o.holdDays} days (the refund window) before they become payable.`} />

      <Card title="Your referral link" description={`Your code is ${o.code}. It works for every course; the most recent link a person clicked wins.`}>
        <ReferralLinkCard link={o.link} code={o.code} />
      </Card>

      <div className="my-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Clicks" value={o.clicks} />
        <StatTile label="Sign-ups" value={o.signups} />
        <StatTile label="Sales" value={o.sales} />
        <StatTile label="On hold" value={m(o.onHold)} hint={`${o.holdDays}-day refund window`} />
        <StatTile label="Payable" value={m(o.payable)} hint={o.payable < 0 ? "A refund reduced your balance" : `Minimum ${m(o.minimumPayoutMinor)}`} />
        <StatTile label="Paid" value={m(o.paid)} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_0.6fr]">
        <Card title="Commission history" description="Buyers are shown by first name and last initial only.">
          {commissions.length === 0 ? (
            <EmptyState title="No commissions yet" description="They appear here as soon as someone you referred pays for a course." />
          ) : (
            <div className="-mx-2 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[13.5px]">
                <thead className="text-[11.5px] tracking-[0.1em] text-ink-400 uppercase">
                  <tr><th className="px-2 py-2 font-semibold">Buyer</th><th className="px-2 py-2 font-semibold">Course</th><th className="px-2 py-2 text-right font-semibold">Price</th><th className="px-2 py-2 text-right font-semibold">Rate</th><th className="px-2 py-2 text-right font-semibold">Commission</th><th className="px-2 py-2 font-semibold">Status</th><th className="px-2 py-2 font-semibold">Date</th></tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {commissions.map((c) => (
                    <tr key={c.id}>
                      <td className="px-2 py-2.5 font-medium text-ink-900">{c.buyer}</td>
                      <td className="px-2 py-2.5 text-ink-700">{c.course}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{formatMoney(c.price, c.currency)}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{c.rateLabel}</td>
                      <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-ink-900">{formatMoney(c.commission, c.currency)}</td>
                      <td className="px-2 py-2.5"><StatusBadge status={c.status} />{c.status === "ON_HOLD" && <span className="ml-1.5 text-[12px] text-ink-400">until {fmtDate(c.availableAt)}</span>}</td>
                      <td className="px-2 py-2.5 whitespace-nowrap text-ink-500">{fmtDate(c.date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-5">
          <Card title="Payouts" description="Hirewise pays out by GCash or bank transfer once you reach the minimum.">
            <RequestPayoutButton
              enabled={o.canRequestPayout && !!details && !open}
              label={`Request payout${o.payable > 0 ? ` of ${m(o.payable)}` : ""}`}
              hint={open ? "A payout is already in progress." : !details ? "Add your payout details first." : shortfall > 0 ? `You need ${m(shortfall)} more to reach the ${m(o.minimumPayoutMinor)} minimum.` : "Your whole payable balance is paid in one payout."}
            />
            {payouts.length > 0 && (
              <ul className="mt-4 divide-y divide-ink-100 text-[13px]">
                {payouts.slice(0, 6).map((p) => (
                  <li key={p.id} className="flex items-start justify-between gap-2 py-2">
                    <span><span className="font-semibold text-ink-900">{formatMoney(p.amount, p.currency)}</span> <span className="text-ink-500">· {p.accountLabel} · {fmtDate(p.requestedAt)}</span>{p.reference && <span className="block text-ink-400">Ref {p.reference}</span>}{p.rejectReason && <span className="block text-ink-400">{p.rejectReason}</span>}</span>
                    <StatusBadge status={p.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Payout details" description="Where Hirewise sends your money. The number is stored encrypted and shown masked.">
            <PayoutDetailsForm current={details ? { method: details.method, accountName: details.accountName, bankName: details.bankName, accountMasked: details.accountMasked } : null} />
          </Card>
        </div>
      </div>

      <p className="mt-6 text-[12px] text-ink-400">Program terms are provided by Hirewise and apply to every referral. Self-referrals earn nothing, and commissions on refunded or charged-back purchases are reversed.</p>
    </>
  );
}
