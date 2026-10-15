import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { listSeatRequests, listSeatPurchases } from "@/server/services/seat.service";
import { ForbiddenError } from "@/server/policies/authorize";
import { PageHeader, Card, Banner, EmptyState, StatusBadge, StatTile, fmtDate } from "@/components/app/ui";
import { SeatRequestDecisionForm, SeatPurchaseRecordForm } from "@/components/agency/AdminSeatForms";

export const metadata: Metadata = { title: "Seat requests and purchases" };

/** v2 phase 2: the Admin queues for seat requests and seat package purchases. */
export default async function SeatQueuesPage({ searchParams }: { searchParams: Promise<{ tab?: string; status?: string }> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const tab = sp.tab === "purchases" ? "purchases" : "requests";
  let requests: Awaited<ReturnType<typeof listSeatRequests>>;
  let purchases: Awaited<ReturnType<typeof listSeatPurchases>>;
  try {
    [requests, purchases] = await Promise.all([
      listSeatRequests(prisma, actor, tab === "requests" && (sp.status === "PENDING" || sp.status === "APPROVED" || sp.status === "REJECTED") ? sp.status : tab === "requests" && !sp.status ? "PENDING" : undefined),
      listSeatPurchases(prisma, actor, tab === "purchases" && (sp.status === "PENDING" || sp.status === "PAID" || sp.status === "WAIVED" || sp.status === "CANCELLED") ? sp.status : tab === "purchases" && !sp.status ? "PENDING" : undefined),
    ]);
  } catch (e) {
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="No access">Seat queues are for Hirewise staff with agency permissions.</Banner>;
    throw e;
  }
  const canDecide = actor.permissions.has("agency.seats.manage");
  return (
    <>
      <Link href="/staff/agencies?tab=agencies" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> Agencies</Link>
      <PageHeader eyebrow="Hirewise admin" title="Seat requests and purchases" description="Agencies ask for seats or buy packages; every approval becomes a ledger entry with a reason." />
      <div className="mb-6 flex gap-2">
        {[["requests", "Seat requests"], ["purchases", "Purchases"]].map(([k, l]) => <Link key={k} href={`/staff/agencies/seats?tab=${k}`} className={`rounded-full border px-4 py-1.5 text-[13.5px] font-semibold ${tab === k ? "border-ink-900 bg-ink-900 text-white" : "border-ink-200 bg-white text-ink-700 hover:bg-ink-50"}`}>{l}</Link>)}
      </div>
      {tab === "requests" ? (
        <>
          <div className="mb-5 grid gap-4 sm:grid-cols-3"><StatTile label="Pending" value={requests.counts.PENDING ?? 0} href="/staff/agencies/seats?status=PENDING" /><StatTile label="Approved" value={requests.counts.APPROVED ?? 0} href="/staff/agencies/seats?status=APPROVED" /><StatTile label="Rejected" value={requests.counts.REJECTED ?? 0} href="/staff/agencies/seats?status=REJECTED" /></div>
          {requests.rows.length === 0 ? <Card><EmptyState title="No seat requests" /></Card> : (
            <div className="space-y-4">
              {requests.rows.map((r) => (
                <Card key={r.id} title={<span><Link href={`/staff/agencies/${r.agencyId}`} className="hover:text-brand-700">{r.agencyName}</Link> · {r.requestedSeats} seat(s)</span>} description={`${fmtDate(r.createdAt)}${r.note ? ` · ${r.note}` : ""}`} actions={<StatusBadge status={r.status} />}>
                  {r.status === "PENDING" && canDecide ? <SeatRequestDecisionForm requestId={r.id} requestedSeats={r.requestedSeats} /> : <p className="text-[13px] text-ink-500">{r.status === "APPROVED" ? `${r.grantedSeats} seat(s) added` : r.status === "REJECTED" ? "Rejected" : "Awaiting an Admin"}{r.decisionNote ? ` · ${r.decisionNote}` : ""}{r.reviewedAt ? ` · ${fmtDate(r.reviewedAt)}` : ""}</p>}
                </Card>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="mb-5 grid gap-4 sm:grid-cols-4"><StatTile label="Pending" value={purchases.counts.PENDING ?? 0} href="/staff/agencies/seats?tab=purchases&status=PENDING" /><StatTile label="Paid" value={purchases.counts.PAID ?? 0} href="/staff/agencies/seats?tab=purchases&status=PAID" /><StatTile label="Waived" value={purchases.counts.WAIVED ?? 0} href="/staff/agencies/seats?tab=purchases&status=WAIVED" /><StatTile label="Cancelled" value={purchases.counts.CANCELLED ?? 0} href="/staff/agencies/seats?tab=purchases&status=CANCELLED" /></div>
          {purchases.rows.length === 0 ? <Card><EmptyState title="No purchases" /></Card> : (
            <div className="space-y-4">
              {purchases.rows.map((p) => (
                <Card key={p.id} title={<span><Link href={`/staff/agencies/${p.agencyId}`} className="hover:text-brand-700">{p.agencyName}</Link> · {p.packageName}</span>} description={`${p.seatCount} seat(s) · ${p.amountLabel} · ${fmtDate(p.createdAt)}${p.note ? ` · ${p.note}` : ""}`} actions={<StatusBadge status={p.status} />}>
                  {p.status === "PENDING" && canDecide ? <SeatPurchaseRecordForm purchaseId={p.id} /> : <p className="text-[13px] text-ink-500">{p.status.toLowerCase()}{p.paymentReference ? ` · ref ${p.paymentReference}` : ""}{p.paidAt ? ` · ${fmtDate(p.paidAt)}` : ""}</p>}
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
