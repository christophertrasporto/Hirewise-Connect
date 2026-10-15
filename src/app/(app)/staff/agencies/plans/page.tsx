import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { listPlansForAdmin, listPackagesForAdmin } from "@/server/services/seat.service";
import { ForbiddenError } from "@/server/policies/authorize";
import { PageHeader, Card, Banner } from "@/components/app/ui";
import { PlanForm, PackageForm } from "@/components/agency/AdminSeatForms";

export const metadata: Metadata = { title: "Plans and seat packages" };

/** v2 phase 2: membership plans and seat packages. Prices live here, never in code. */
export default async function PlansPage() {
  const actor = await requireActor();
  let plans: Awaited<ReturnType<typeof listPlansForAdmin>>;
  let packages: Awaited<ReturnType<typeof listPackagesForAdmin>>;
  try {
    [plans, packages] = await Promise.all([listPlansForAdmin(prisma, actor), listPackagesForAdmin(prisma, actor)]);
  } catch (e) {
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="Requires agency.plans.manage">Plans and packages are managed by Admins.</Banner>;
    throw e;
  }
  const unpriced = plans.filter((p) => p.isActive && p.priceMinor === 0).length + packages.filter((p) => p.isActive && p.priceMinor === 0).length;
  return (
    <>
      <Link href="/staff/agencies?tab=agencies" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> Agencies</Link>
      <PageHeader eyebrow="Hirewise admin" title="Plans and seat packages" description="A plan gives an agency its base Agent Seats; packages add more. Changing a plan or a price here never changes an agency's existing seats: those are ledger entries with reasons." />
      {unpriced > 0 && <div className="mb-5"><Banner tone="warn" title={`${unpriced} active plan(s) or package(s) still have no price`}>Prices are placeholders at 0 until you set them. Agencies see &quot;Price to be set&quot;.</Banner></div>}
      <div className="space-y-5">
        {plans.map((p) => (
          <Card key={p.key} title={`${p.name} · ${p.baseAgentSeats === null ? "custom seats" : `${p.baseAgentSeats} agent seats`} · ${p.priceLabel}`} description={`${p.key}${p.isActive ? "" : " · inactive"}`}>
            <PlanForm plan={p} />
          </Card>
        ))}
        <Card title="New plan"><PlanForm plan={null} /></Card>
        {packages.map((p) => (
          <Card key={p.id} title={`${p.name} · ${p.priceLabel}`} description={p.isActive ? "Seat package" : "Seat package · inactive"}>
            <PackageForm pkg={p} />
          </Card>
        ))}
        <Card title="New seat package"><PackageForm pkg={null} /></Card>
      </div>
    </>
  );
}
