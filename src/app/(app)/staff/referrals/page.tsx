import type { Metadata } from "next";
import Link from "next/link";
import { Flag } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { authorize } from "@/server/policies/authorize";
import { getReferralSettings, listAffiliates } from "@/server/services/referral-admin.service";
import { formatMoney } from "@/server/views/seat.views";
import { Card, EmptyState } from "@/components/app/ui";
import { ReferralSettingsForm } from "@/components/referral/StaffForms";

export const metadata: Metadata = { title: "Referrals" };

export default async function StaffReferralsPage() {
  const actor = await requireActor();
  authorize(actor, "referral.manage");
  const [settings, { rows, currency }] = await Promise.all([getReferralSettings(prisma, actor), listAffiliates(prisma, actor)]);
  const m = (n: number) => formatMoney(n, currency);
  return (
    <div className="space-y-5">
      <Card title="Program settings" description="The rate applies to future sales only: every commission stores the rate it was made at. The hold period is counted from the confirmed payment.">
        <ReferralSettingsForm s={settings} />
      </Card>
      <Card title={`Affiliates (${rows.length})`} description="Members with clicks, referred sign-ups, or commissions. Open one to see the ledger, flags, and adjustments.">
        {rows.length === 0 ? <EmptyState title="No referral activity yet" description="Members get a link on their Refer & Earn page." /> : (
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[13.5px]">
              <thead className="text-[11.5px] tracking-[0.1em] text-ink-400 uppercase">
                <tr><th className="px-2 py-2 font-semibold">Affiliate</th><th className="px-2 py-2 text-right font-semibold">Clicks</th><th className="px-2 py-2 text-right font-semibold">Sign-ups</th><th className="px-2 py-2 text-right font-semibold">Sales</th><th className="px-2 py-2 text-right font-semibold">On hold</th><th className="px-2 py-2 text-right font-semibold">Payable</th><th className="px-2 py-2 text-right font-semibold">Paid</th><th className="px-2 py-2 font-semibold">Flags</th></tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {rows.map((r) => (
                  <tr key={r.userId}>
                    <td className="px-2 py-2.5"><Link href={`/staff/referrals/${r.userId}`} className="font-semibold text-ink-900 hover:text-brand-700">{r.name ?? r.email}</Link><span className="block text-[12px] text-ink-400">{r.name ? `${r.email} · ` : ""}{r.code ?? "no code yet"}</span></td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{r.clicks}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{r.signups}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{r.sales}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{m(r.onHold)}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{m(r.payable)}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{m(r.paid)}</td>
                    <td className="px-2 py-2.5">{r.openFlags > 0 ? <span className="inline-flex items-center gap-1 rounded-full bg-gold-50 px-2.5 py-0.5 text-[12px] font-semibold text-gold-800 ring-1 ring-gold-200 ring-inset"><Flag className="h-3 w-3" /> {r.openFlags}</span> : <span className="text-ink-300">None</span>}</td>
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
