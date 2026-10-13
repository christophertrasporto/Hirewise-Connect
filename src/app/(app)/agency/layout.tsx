import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { myAgency } from "@/server/services/agency.service";
import { NotFoundError } from "@/server/policies/authorize";
import { Banner, PageHeader, StatusBadge } from "@/components/app/ui";
import { AgencyTabs } from "@/components/agency/AgencyTabs";

/**
 * Agency Owner portal shell (Agency A1). Rendered only for users with an Owner or Manager seat; everyone else gets
 * NotFound so the portal's existence is not an oracle. Suspended and inactive agencies see a banner and read-only pages.
 */
export default async function AgencyPortalLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  if (!actor.agency) notFound();
  let agency: Awaited<ReturnType<typeof myAgency>>;
  try {
    agency = await myAgency(prisma, actor);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  return (
    <>
      <PageHeader eyebrow={`Agency portal · ${actor.agency.role === "OWNER" ? "Owner" : "Manager"}`} title={agency.name} description={`${agency.city ? `${agency.city}, ` : ""}${agency.country} · ${agency.agentCount} agent${agency.agentCount === 1 ? "" : "s"}`} actions={<StatusBadge status={agency.status} />} />
      {agency.status !== "ACTIVE" && (
        <div className="mb-5">
          <Banner tone="warn" title={agency.status === "SUSPENDED" ? "Your agency is suspended" : "Your agency is inactive"}>
            {agency.statusReason ? `${agency.statusReason} ` : ""}Your data is kept and you can still read everything here, but invites, training purchases, and submissions are paused. <Link href="/notifications" className="font-semibold underline underline-offset-2">Contact Hirewise</Link> to restore access.
          </Banner>
        </div>
      )}
      <AgencyTabs />
      {children}
    </>
  );
}
