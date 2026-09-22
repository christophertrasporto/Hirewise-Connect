import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { listPlacementsForStaff } from "@/server/services/placement.service";
import { PageHeader, Card, StatusBadge, EmptyState, fmtDate } from "@/components/app/ui";

export const metadata: Metadata = { title: "Placements" };

export default async function StaffPlacementsPage() {
  const actor = await requireActor();
  const rows = await listPlacementsForStaff(prisma, actor);
  return (
    <>
      <PageHeader eyebrow="Placements" title="Placement records" description="Created at client selection. The commercial pipeline (Hirewise approval, agreement, deposit, deployment checklist, activation) arrives in Phase 4." />
      <Card>
        {rows.length === 0 ? <EmptyState title="No placements yet" /> : (
          <table className="w-full text-left text-[14px]">
            <thead className="text-[12px] uppercase tracking-[0.12em] text-ink-400"><tr><th className="pb-3 font-semibold">Candidate</th><th className="pb-3 font-semibold">Client</th><th className="pb-3 font-semibold">Position</th><th className="pb-3 font-semibold">Selected</th><th className="pb-3 font-semibold">Manager</th><th className="pb-3 font-semibold">Status</th></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="py-3"><Link href={`/staff/talent/${p.agent.id}`} className="font-semibold text-brand-600">{p.agent.displayName}</Link></td>
                  <td className="py-3 text-ink-800">{p.client.companyName}</td>
                  <td className="py-3 text-ink-700">{p.positionTitle}{p.schedule ? ` · ${p.schedule}` : ""}</td>
                  <td className="py-3 text-ink-500">{fmtDate(p.createdAt)}</td>
                  <td className="py-3 text-ink-500">{p.accountManager?.email ?? "—"}</td>
                  <td className="py-3"><StatusBadge status={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
