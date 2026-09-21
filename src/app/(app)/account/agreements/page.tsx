import type { Metadata } from "next";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { acceptanceHistory } from "@/server/services/agreement.service";
import { PageHeader, Card, EmptyState } from "@/components/app/ui";

export const metadata: Metadata = { title: "Agreements" };

export default async function AgreementsHistoryPage() {
  const actor = await requireActor();
  const rows = await acceptanceHistory(prisma, actor);
  return (
    <>
      <PageHeader title="Your agreements" description="Every version you accepted, with the time and device we recorded." />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No acceptances recorded" />
        ) : (
          <table className="w-full text-left text-[14px]">
            <thead className="text-[12px] uppercase tracking-[0.12em] text-ink-400">
              <tr>
                <th className="pb-3 font-semibold">Agreement</th>
                <th className="pb-3 font-semibold">Version</th>
                <th className="pb-3 font-semibold">Accepted</th>
                <th className="pb-3 font-semibold">From</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-3 font-medium text-ink-800">{r.agreement.title}</td>
                  <td className="py-3 text-ink-600">v{r.agreement.version}</td>
                  <td className="py-3 text-ink-600">{new Date(r.acceptedAt).toLocaleString()}</td>
                  <td className="py-3 text-ink-400">{r.ipAddress ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
