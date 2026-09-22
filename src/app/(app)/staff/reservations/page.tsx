import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { listReservations } from "@/server/services/reservation.service";
import { PageHeader, Card, StatusBadge, EmptyState } from "@/components/app/ui";
import { ReservationRowActions } from "@/components/staff/ReservationForm";

export const metadata: Metadata = { title: "Reservations" };

export default async function ReservationsPage() {
  const actor = await requireActor();
  const rows = await listReservations(prisma, actor);
  return (
    <>
      <PageHeader eyebrow="Sales" title="Candidate reservations" description="A reserved candidate is held for one client so two reps never promise the same person. Holds expire automatically; extend them while a deal is live." />
      <Card>
        {rows.length === 0 ? <EmptyState title="No active reservations" description="Reserve from a candidate's profile in the Talent console." /> : (
          <table className="w-full text-left text-[14px]">
            <thead className="text-[12px] uppercase tracking-[0.12em] text-ink-400"><tr><th className="pb-3 font-semibold">Candidate</th><th className="pb-3 font-semibold">Held for</th><th className="pb-3 font-semibold">Expires</th><th className="pb-3 font-semibold">By</th><th className="pb-3 font-semibold">Reason</th><th className="pb-3" /></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-3"><Link href={`/staff/talent/${r.agent.id}`} className="font-semibold text-brand-600">{r.agent.displayName}</Link> <StatusBadge status={r.agent.availabilityStatus} /></td>
                  <td className="py-3 text-ink-800">{r.client.companyName}</td>
                  <td className="py-3 text-ink-700">{new Date(r.expiresAt).toLocaleString()}{r.extensions ? ` · extended ×${r.extensions}` : ""}</td>
                  <td className="py-3 text-ink-500">{r.reservedBy}</td>
                  <td className="py-3 text-[13px] text-ink-500">{r.reason ?? "—"}</td>
                  <td className="py-3"><ReservationRowActions reservationId={r.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
