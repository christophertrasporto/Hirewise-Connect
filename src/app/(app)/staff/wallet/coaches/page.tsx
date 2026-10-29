import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { authorize } from "@/server/policies/authorize";
import { listCoachWallets, WALLET_CURRENCY } from "@/server/services/wallet.service";
import { formatMoney } from "@/server/views/seat.views";
import { Card, EmptyState } from "@/components/app/ui";

export const metadata: Metadata = { title: "Coach wallets" };
const money = (n: number) => formatMoney(n, WALLET_CURRENCY);

export default async function StaffCoachWalletsPage() {
  const actor = await requireActor();
  authorize(actor, "wallet.manage");
  const rows = await listCoachWallets(prisma, actor);
  return (
    <Card title="Coaches" description="Balances are always calculated from each coach's ledger. A special rate, if any, is shown beside the coach.">
      {rows.length === 0 ? (
        <EmptyState title="No coaches yet" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[13.5px]">
            <thead className="text-[11.5px] uppercase tracking-[0.1em] text-ink-400">
              <tr>
                <th className="py-2 pr-3 font-semibold">Coach</th>
                <th className="py-2 pr-3 text-right font-semibold">On hold</th>
                <th className="py-2 pr-3 text-right font-semibold">Available</th>
                <th className="py-2 pr-3 text-right font-semibold">Withdrawn</th>
                <th className="py-2 pr-3 text-right font-semibold">Waiting for fee</th>
                <th className="py-2 font-semibold">Share</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="py-3 pr-3"><Link href={`/staff/wallet/coaches/${c.id}`} className="font-semibold text-ink-900 hover:text-brand-700">{c.email}</Link></td>
                  <td className="py-3 pr-3 text-right">{money(c.balance.onHold)}</td>
                  <td className={`py-3 pr-3 text-right font-semibold ${c.balance.available < 0 ? "text-red-600" : "text-ink-900"}`}>{money(c.balance.available)}</td>
                  <td className="py-3 pr-3 text-right">{money(c.balance.withdrawn)}</td>
                  <td className="py-3 pr-3 text-right">{c.balance.pendingFeeCount ? `${c.balance.pendingFeeCount} (${money(c.balance.pendingFeeSaleMinor)})` : "None"}</td>
                  <td className="py-3">
                    {c.shareBps / 100}%
                    {c.hasOverride && <span className="ml-1 rounded-full bg-gold-50 px-2 py-0.5 text-[11px] font-semibold text-gold-700 ring-1 ring-inset ring-gold-200" title={c.overrideNote ?? ""}>special</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
