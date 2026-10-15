import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { getAgencyForStaff, agencyAgents, listAgencies } from "@/server/services/agency.service";
import { can, ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { PageHeader, Card, StatusBadge, EmptyState, Banner, fmtDate } from "@/components/app/ui";
import { AgencyStatusForm, SetAgentAgencyForm } from "@/components/agency/ReviewPanel";
import { AdminSeatChangeForm, AssignPlanForm } from "@/components/agency/AdminSeatForms";
import { seatSummary, activePlans } from "@/server/services/seat.service";

export const metadata: Metadata = { title: "Agency" };

export default async function AgencyStaffPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  let agency: Awaited<ReturnType<typeof getAgencyForStaff>>;
  let agents: Awaited<ReturnType<typeof agencyAgents>>;
  try {
    agency = await getAgencyForStaff(prisma, actor, id);
    agents = await agencyAgents(prisma, actor, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="No access">Agencies are visible to Hirewise staff with agency permissions.</Banner>;
    throw e;
  }
  const manages = can(actor, "agency.manage");
  const managesSeats = can(actor, "agency.seats.manage");
  const [agencies, seats, plans] = await Promise.all([manages ? listAgencies(prisma, actor).then((rows) => rows.map((a) => ({ id: a.id, name: a.name }))) : Promise.resolve([]), seatSummary(prisma, actor, id), activePlans(prisma)]);
  const t = seats.totals;

  return (
    <>
      <Link href="/staff/agencies?tab=agencies" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> Agencies</Link>
      <PageHeader eyebrow="Partner agency" title={agency.name} description={`${agency.city ? `${agency.city}, ` : ""}${agency.country} · owner ${agency.owner.email} · joined ${fmtDate(agency.joinedAt)}${agency.applicationId ? "" : " · created directly"}`} actions={<StatusBadge status={agency.status} />} />
      {agency.status !== "ACTIVE" && <div className="mb-5"><Banner tone="warn" title={`${agency.status === "SUSPENDED" ? "Suspended" : "Inactive"}${agency.suspendedAt && agency.status === "SUSPENDED" ? ` since ${fmtDate(agency.suspendedAt)}` : ""}`}>{agency.statusReason}</Banner></div>}
      <div className="mb-5">
        <Card title={`Agent Seats · ${t.used} of ${t.total} in use · ${t.available} available`} description={`Plan: ${seats.plan ? `${seats.plan.name} (${seats.plan.baseAgentSeats === null ? "custom" : seats.plan.baseAgentSeats} base seats, ${seats.plan.priceLabel})` : "none assigned; invites are paused until one is set"} · ${t.base} plan · ${t.additional} purchased · ${t.promo} promo${t.adjustments ? ` · ${t.adjustments > 0 ? "+" : ""}${t.adjustments} adjusted` : ""}${seats.openInvites ? ` · ${seats.openInvites} open invite(s)` : ""}${seats.overCapacity ? " · OVER CAPACITY" : ""}`}>
          {managesSeats ? (
            <div className="grid gap-6 lg:grid-cols-2">
              <div><p className="mb-2 text-[13px] font-semibold text-ink-700">Change seats</p><AdminSeatChangeForm agencyId={agency.id} /></div>
              <div><p className="mb-2 text-[13px] font-semibold text-ink-700">Plan</p><AssignPlanForm agencyId={agency.id} plans={plans} currentKey={seats.plan?.key ?? null} /></div>
            </div>
          ) : <p className="text-[13px] text-ink-500">Seat changes and plan assignment need agency.seats.manage.</p>}
          <details className="mt-5">
            <summary className="cursor-pointer text-[13px] font-semibold text-ink-600">Ledger ({seats.history.length}) · requests ({seats.requests.length}) · purchases ({seats.purchases.length})</summary>
            <table className="mt-3 w-full text-left text-[13px]">
              <thead className="text-[11.5px] uppercase tracking-[0.12em] text-ink-400"><tr><th className="pb-2 font-semibold">When</th><th className="pb-2 font-semibold">Change</th><th className="pb-2 font-semibold">Seats</th><th className="pb-2 font-semibold">Reason</th></tr></thead>
              <tbody className="divide-y divide-ink-100">{seats.history.map((h) => <tr key={h.id}><td className="py-1.5 text-ink-500">{fmtDate(h.effectiveAt)}</td><td className="py-1.5 text-ink-800">{h.changeType.toLowerCase().replace(/_/g, " ")}{h.planName ? ` (${h.planName})` : ""}</td><td className="py-1.5 tabular-nums text-ink-800">{h.capacityDelta ? (h.capacityDelta > 0 ? `+${h.capacityDelta}` : h.capacityDelta) : h.usageDelta > 0 ? "1 used" : "1 freed"}</td><td className="py-1.5 text-ink-500">{h.reason ?? "—"}</td></tr>)}</tbody>
            </table>
            <p className="mt-3 text-[12.5px] text-ink-400">Seat requests and purchases are decided under <Link href="/staff/agencies/seats" className="font-semibold text-brand-700">Seat requests and purchases</Link>.</p>
          </details>
        </Card>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-5">
          <Card title="Profile">
            <dl className="divide-y divide-ink-50 text-[13.5px]">
              {[["Contact", `${agency.contactEmail}${agency.contactPhone ? ` · ${agency.contactPhone}` : ""}`], ["Website", agency.website ?? "—"], ["Training access", agency.trainingAccess ? "On" : "Off"], ["Opportunity access", agency.opportunityAccess ? "On" : "Off"], ["Application", agency.applicationId ? "From an approved application" : "Created directly by a Super Admin"]].map(([k, v]) => <div key={k} className="flex justify-between gap-4 py-1.5"><dt className="text-ink-500">{k}</dt><dd className="text-right font-medium text-ink-800">{k === "Application" && agency.applicationId ? <Link href={`/staff/agencies/applications/${agency.applicationId}`} className="text-brand-600">{v}</Link> : v}</dd></div>)}
            </dl>
            {agency.description && <p className="mt-4 whitespace-pre-line rounded-2xl bg-ink-50 p-4 text-[14px] text-ink-700">{agency.description}</p>}
          </Card>
          <Card title={`Agents (${agents.length})`} description="Members in any open membership status. Agencies invite their own agents from their portal; moving an agent here releases and takes seats.">
            {agents.length === 0 ? <EmptyState title="No agents yet" /> : (
              <ul className="divide-y divide-ink-100">
                {agents.map((p) => (
                  <li key={p.id} className="space-y-2 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2"><Link href={`/staff/talent/${p.id}`} className="font-semibold text-ink-900 hover:text-brand-700">{p.displayName}</Link><span className="flex gap-2"><StatusBadge status={p.membershipStatus} /><StatusBadge status={p.status} /><StatusBadge status={p.availabilityStatus} /></span></div>
                    {manages && <SetAgentAgencyForm agentProfileId={p.id} currentAgencyId={agency.id} agencies={agencies} />}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="space-y-5">
          <Card title="Seats"><ul className="space-y-1 text-[13.5px]">{agency.seats.map((s) => <li key={s.userId} className="flex justify-between"><span className="text-ink-800">{s.email}</span><span className="text-ink-400">{s.role === "OWNER" ? "Owner" : "Manager"}</span></li>)}</ul></Card>
          {manages && <Card title="Status" description="Suspended agencies keep read access and all their data; invites, purchases, and submissions pause. Deactivation is the same but signals the agency has left."><AgencyStatusForm agencyId={agency.id} status={agency.status} /></Card>}
        </div>
      </div>
    </>
  );
}
