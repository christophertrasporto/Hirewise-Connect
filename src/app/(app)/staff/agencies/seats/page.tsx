import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { listSeatRequests, listSeatPurchases } from "@/server/services/seat.service";
import { listCoursePurchases } from "@/server/services/training.service";
import { listIndependentAccess } from "@/server/services/independent.service";
import { ForbiddenError } from "@/server/policies/authorize";
import { PageHeader, Card, Banner, EmptyState, StatusBadge, StatTile, fmtDate } from "@/components/app/ui";
import { SeatRequestDecisionForm, SeatPurchaseRecordForm } from "@/components/agency/AdminSeatForms";
import { RecordOutcomeForm } from "@/components/agency/TrainingPanels";

export const metadata: Metadata = { title: "Seat requests and purchases" };

type Tab = "requests" | "purchases" | "courses" | "independent";

/** The Admin queues: Agent Seat requests and packages (phase 2), Course Seat purchases and independent access (phase 4). */
export default async function SeatQueuesPage({ searchParams }: { searchParams: Promise<{ tab?: string; status?: string }> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const tab: Tab = sp.tab === "purchases" || sp.tab === "courses" || sp.tab === "independent" ? sp.tab : "requests";
  const canDecide = actor.permissions.has("agency.seats.manage");
  const pick = <T extends string>(allowed: readonly T[], fallback: T): T | undefined => (sp.status === "" ? undefined : (allowed as readonly string[]).includes(sp.status ?? "") ? (sp.status as T) : sp.status ? undefined : fallback);
  try {
    if (tab === "requests") {
      const requests = await listSeatRequests(prisma, actor, pick(["PENDING", "APPROVED", "REJECTED"] as const, "PENDING"));
      return (
        <Shell tab={tab}>
          <div className="mb-5 grid gap-4 sm:grid-cols-3"><StatTile label="Pending" value={requests.counts.PENDING ?? 0} href="/staff/agencies/seats?status=PENDING" /><StatTile label="Approved" value={requests.counts.APPROVED ?? 0} href="/staff/agencies/seats?status=APPROVED" /><StatTile label="Rejected" value={requests.counts.REJECTED ?? 0} href="/staff/agencies/seats?status=REJECTED" /></div>
          {requests.rows.length === 0 ? <Card><EmptyState title="No seat requests" /></Card> : <div className="space-y-4">{requests.rows.map((r) => <Card key={r.id} title={<span><Link href={`/staff/agencies/${r.agencyId}`} className="hover:text-brand-700">{r.agencyName}</Link> · {r.requestedSeats} Agent Seat(s)</span>} description={`${fmtDate(r.createdAt)}${r.note ? ` · ${r.note}` : ""}`} actions={<StatusBadge status={r.status} />}>{r.status === "PENDING" && canDecide ? <SeatRequestDecisionForm requestId={r.id} requestedSeats={r.requestedSeats} /> : <p className="text-[13px] text-ink-500">{r.status === "APPROVED" ? `${r.grantedSeats} seat(s) added` : r.status === "REJECTED" ? "Rejected" : "Awaiting an Admin"}{r.decisionNote ? ` · ${r.decisionNote}` : ""}{r.reviewedAt ? ` · ${fmtDate(r.reviewedAt)}` : ""}</p>}</Card>)}</div>}
        </Shell>
      );
    }
    if (tab === "purchases") {
      const purchases = await listSeatPurchases(prisma, actor, pick(["PENDING", "PAID", "WAIVED", "CANCELLED"] as const, "PENDING"));
      return (
        <Shell tab={tab}>
          <div className="mb-5 grid gap-4 sm:grid-cols-4">{(["PENDING", "PAID", "WAIVED", "CANCELLED"] as const).map((s) => <StatTile key={s} label={s.toLowerCase()} value={purchases.counts[s] ?? 0} href={`/staff/agencies/seats?tab=purchases&status=${s}`} />)}</div>
          {purchases.rows.length === 0 ? <Card><EmptyState title="No seat package purchases" /></Card> : <div className="space-y-4">{purchases.rows.map((p) => <Card key={p.id} title={<span><Link href={`/staff/agencies/${p.agencyId}`} className="hover:text-brand-700">{p.agencyName}</Link> · {p.packageName}</span>} description={`${p.seatCount} Agent Seat(s) · ${p.amountLabel} · ${fmtDate(p.createdAt)}${p.note ? ` · ${p.note}` : ""}`} actions={<StatusBadge status={p.status} />}>{p.status === "PENDING" && canDecide ? <SeatPurchaseRecordForm purchaseId={p.id} /> : <p className="text-[13px] text-ink-500">{p.status.toLowerCase()}{p.paymentReference ? ` · ref ${p.paymentReference}` : ""}{p.paidAt ? ` · ${fmtDate(p.paidAt)}` : ""}</p>}</Card>)}</div>}
        </Shell>
      );
    }
    if (tab === "courses") {
      const courses = await listCoursePurchases(prisma, actor, pick(["PENDING", "PAID", "WAIVED", "CANCELLED"] as const, "PENDING"));
      return (
        <Shell tab={tab}>
          <div className="mb-5 grid gap-4 sm:grid-cols-4">{(["PENDING", "PAID", "WAIVED", "CANCELLED"] as const).map((s) => <StatTile key={s} label={s.toLowerCase()} value={courses.counts[s] ?? 0} href={`/staff/agencies/seats?tab=courses&status=${s}`} />)}</div>
          {courses.rows.length === 0 ? <Card><EmptyState title="No Course Seat purchases" /></Card> : <div className="space-y-4">{courses.rows.map((p) => <Card key={p.id} title={<span><Link href={`/staff/agencies/${p.agencyId}`} className="hover:text-brand-700">{p.agencyName}</Link> · {p.courseTitle}</span>} description={`${p.seatCount} Course Seat(s) · ${p.amountLabel} · ${fmtDate(p.createdAt)}${p.note ? ` · ${p.note}` : ""}${p.assigned ? ` · ${p.assigned} assigned` : ""}`} actions={<StatusBadge status={p.status} />}>{p.status === "PENDING" && canDecide ? <RecordOutcomeForm kind="COURSE_PURCHASE" id={p.id} /> : <p className="text-[13px] text-ink-500">{p.status.toLowerCase()}{p.paymentReference ? ` · ref ${p.paymentReference}` : ""}{p.paidAt ? ` · ${fmtDate(p.paidAt)}` : ""}</p>}</Card>)}</div>}
        </Shell>
      );
    }
    const independent = await listIndependentAccess(prisma, actor, pick(["PENDING_PAYMENT", "ACTIVE", "CANCELLED"] as const, "PENDING_PAYMENT"));
    return (
      <Shell tab={tab}>
        <div className="mb-5 grid gap-4 sm:grid-cols-3">{(["PENDING_PAYMENT", "ACTIVE", "CANCELLED"] as const).map((s) => <StatTile key={s} label={s.toLowerCase().replace(/_/g, " ")} value={independent.counts[s] ?? 0} href={`/staff/agencies/seats?tab=independent&status=${s}`} />)}</div>
        {independent.rows.length === 0 ? <Card><EmptyState title="No independent access records" /></Card> : <div className="space-y-4">{independent.rows.map((r) => <Card key={r.id} title={r.email} description={`Independent access · ${r.amountLabel} · ${fmtDate(r.createdAt)}${r.note ? ` · ${r.note}` : ""}`} actions={<StatusBadge status={r.status} />}>{r.status === "PENDING_PAYMENT" && canDecide ? <RecordOutcomeForm kind="INDEPENDENT_ACCESS" id={r.id} /> : <p className="text-[13px] text-ink-500">{r.status.toLowerCase().replace(/_/g, " ")}{r.paymentReference ? ` · ref ${r.paymentReference}` : ""}{r.profileId ? <> · <Link href={`/staff/talent/${r.profileId}`} className="font-semibold text-brand-700">fresh profile</Link></> : null}</p>}</Card>)}</div>}
      </Shell>
    );
  } catch (e) {
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="No access">Seat queues are for Hirewise staff with agency permissions.</Banner>;
    throw e;
  }
}

function Shell({ tab, children }: { tab: Tab; children: React.ReactNode }) {
  const tabs: Array<[Tab, string]> = [["requests", "Agent Seat requests"], ["purchases", "Seat packages"], ["courses", "Course purchases"], ["independent", "Independent access"]];
  return (
    <>
      <Link href="/staff/agencies?tab=agencies" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> Agencies</Link>
      <PageHeader eyebrow="Hirewise admin" title="Seat requests and purchases" description="Agent Seat requests and packages, Course Seat purchases, and independent access fees. Every approval or payment becomes a ledger entry or an activation with a reason on record." />
      <div className="mb-6 flex flex-wrap gap-2">
        {tabs.map(([k, l]) => <Link key={k} href={`/staff/agencies/seats?tab=${k}`} className={`rounded-full border px-4 py-1.5 text-[13.5px] font-semibold ${tab === k ? "border-ink-900 bg-ink-900 text-white" : "border-ink-200 bg-white text-ink-700 hover:bg-ink-50"}`}>{l}</Link>)}
      </div>
      {children}
    </>
  );
}
