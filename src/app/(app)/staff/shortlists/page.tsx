import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { shortlistActivityForStaff } from "@/server/services/shortlist.service";
import { PageHeader, Card, StatusBadge, EmptyState } from "@/components/app/ui";

export const metadata: Metadata = { title: "Shortlist activity" };

export default async function StaffShortlistsPage() {
  const actor = await requireActor();
  const rows = await shortlistActivityForStaff(prisma, actor);
  return (
    <>
      <PageHeader eyebrow="Sales" title="Shortlist activity" description={actor.role === "SALES" ? "Clients you manage. A client shortlisting several candidates is a signal to reach out before they request interviews." : "All clients."} />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No shortlist activity yet" description={actor.role === "SALES" ? "You see activity for clients where you are the account manager." : undefined} />
        ) : (
          <table className="w-full text-left text-[14px]">
            <thead className="text-[12px] uppercase tracking-[0.12em] text-ink-400">
              <tr><th className="pb-3 font-semibold">When</th><th className="pb-3 font-semibold">Client</th><th className="pb-3 font-semibold">Candidate</th><th className="pb-3 font-semibold">Status</th><th className="pb-3 font-semibold">Client note</th></tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {rows.map((r) => (
                <tr key={r.id} className={r.removedAt ? "text-ink-400" : ""}>
                  <td className="py-3 whitespace-nowrap">{new Date(r.addedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{r.removedAt ? " (removed)" : ""}</td>
                  <td className="py-3 font-medium text-ink-800">{r.client.companyName}{r.client.managed ? <span className="ml-1.5 rounded-full bg-brand-50 px-2 py-0.5 text-[10.5px] font-semibold text-brand-700">yours</span> : null}</td>
                  <td className="py-3"><Link href={`/staff/talent/${r.agent.id}`} className="font-semibold text-brand-600">{r.agent.displayName}</Link> <span className="text-ink-500">· {r.agent.primaryRole ?? "—"}</span></td>
                  <td className="py-3"><StatusBadge status={r.agent.availabilityStatus} /></td>
                  <td className="py-3 text-[13px] text-ink-500">{r.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
