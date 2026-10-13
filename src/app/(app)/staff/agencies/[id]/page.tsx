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
  const agencies = manages ? (await listAgencies(prisma, actor)).map((a) => ({ id: a.id, name: a.name })) : [];

  return (
    <>
      <Link href="/staff/agencies?tab=agencies" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> Agencies</Link>
      <PageHeader eyebrow="Partner agency" title={agency.name} description={`${agency.city ? `${agency.city}, ` : ""}${agency.country} · owner ${agency.owner.email} · joined ${fmtDate(agency.joinedAt)}${agency.applicationId ? "" : " · created directly"}`} actions={<StatusBadge status={agency.status} />} />
      {agency.status !== "ACTIVE" && <div className="mb-5"><Banner tone="warn" title={`${agency.status === "SUSPENDED" ? "Suspended" : "Inactive"}${agency.suspendedAt && agency.status === "SUSPENDED" ? ` since ${fmtDate(agency.suspendedAt)}` : ""}`}>{agency.statusReason}</Banner></div>}
      <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-5">
          <Card title="Profile">
            <dl className="divide-y divide-ink-50 text-[13.5px]">
              {[["Contact", `${agency.contactEmail}${agency.contactPhone ? ` · ${agency.contactPhone}` : ""}`], ["Website", agency.website ?? "—"], ["Training access", agency.trainingAccess ? "On" : "Off"], ["Opportunity access", agency.opportunityAccess ? "On" : "Off"], ["Application", agency.applicationId ? "From an approved application" : "Created directly by a Super Admin"]].map(([k, v]) => <div key={k} className="flex justify-between gap-4 py-1.5"><dt className="text-ink-500">{k}</dt><dd className="text-right font-medium text-ink-800">{k === "Application" && agency.applicationId ? <Link href={`/staff/agencies/applications/${agency.applicationId}`} className="text-brand-600">{v}</Link> : v}</dd></div>)}
            </dl>
            {agency.description && <p className="mt-4 whitespace-pre-line rounded-2xl bg-ink-50 p-4 text-[14px] text-ink-700">{agency.description}</p>}
          </Card>
          <Card title={`Agents (${agents.length})`} description="Agents whose primary agency is this one. Agencies invite their own agents from their portal (phase A2).">
            {agents.length === 0 ? <EmptyState title="No agents yet" /> : (
              <ul className="divide-y divide-ink-100">
                {agents.map((p) => (
                  <li key={p.id} className="space-y-2 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2"><Link href={`/staff/talent/${p.id}`} className="font-semibold text-ink-900 hover:text-brand-700">{p.displayName}</Link><span className="flex gap-2"><StatusBadge status={p.status} /><StatusBadge status={p.availabilityStatus} /></span></div>
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
