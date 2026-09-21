import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { listClientsForStaff } from "@/server/services/client.service";
import { PageHeader, Card, StatusBadge, EmptyState, fmtDate } from "@/components/app/ui";
import { ActivateClientForm } from "@/components/staff/ActivateClientForm";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Clients" };

const FILTERS = [
  { value: "", label: "All" },
  { value: "PENDING_REVIEW", label: "Awaiting activation" },
  { value: "ACTIVE", label: "Active" },
  { value: "SUSPENDED", label: "Suspended" },
] as const;

export default async function StaffClientsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const actor = await requireActor();
  const { status } = await searchParams;
  const filter = FILTERS.some((f) => f.value === status) ? (status as "PENDING_REVIEW" | "ACTIVE" | "SUSPENDED" | "") : "";
  const clients = await listClientsForStaff(prisma, actor, filter || undefined);
  const canActivate = actor.permissions.has("client.manage");

  return (
    <>
      <PageHeader eyebrow="Clients" title="Client accounts" description="New registrations wait here until Sales qualifies and activates them. Activation opens the talent marketplace for the client." />
      <div className="mb-5 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <Link key={f.value} href={f.value ? `/staff/clients?status=${f.value}` : "/staff/clients"} className={cn("rounded-full px-3.5 py-1.5 text-[13px] font-semibold", filter === f.value ? "bg-ink-900 text-white" : "bg-white text-ink-600 ring-1 ring-inset ring-ink-200 hover:bg-ink-50")}>
            {f.label}
          </Link>
        ))}
      </div>
      {clients.length === 0 ? (
        <EmptyState title="No clients match this filter" />
      ) : (
        <div className="space-y-4">
          {clients.map((c) => (
            <Card key={c.id} title={<span className="flex items-center gap-3">{c.companyName} <StatusBadge status={c.status} /></span>} description={`${c.industry ?? "—"} · ${c.country ?? "—"} · ${c.timezone ?? "—"} · registered ${fmtDate(c.createdAt)}`}>
              <div className="grid gap-5 lg:grid-cols-[1fr_1fr_auto]">
                <div className="text-[14px]">
                  <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Contact</p>
                  <p className="mt-1 font-semibold text-ink-800">{c.contact?.name} <span className="font-normal text-ink-500">· {c.contact?.position}</span></p>
                  <p className="text-ink-600">{c.contact?.businessEmail}{c.contact?.phone ? ` · ${c.contact.phone}` : ""}</p>
                  {c.website && <p className="text-ink-500">{c.website}</p>}
                  <p className="mt-2 text-[12.5px] text-ink-400">Account manager: {c.accountManager?.email ?? "unassigned"}</p>
                </div>
                <div className="text-[14px]">
                  <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Requirement</p>
                  <p className="mt-1 text-ink-800">{c.onboarding?.servicesNeeded.join(", ") || "—"}</p>
                  <p className="text-ink-600">{c.onboarding?.agentsRequired ?? "—"} agent(s) · {c.onboarding?.preferredSchedule || "schedule TBD"} · start {fmtDate(c.onboarding?.expectedStartDate)}</p>
                  {c.onboarding?.notes && <p className="mt-1 text-[13.5px] text-ink-500">{c.onboarding.notes}</p>}
                </div>
                <div className="lg:w-[260px]">{canActivate && c.status === "PENDING_REVIEW" && <ActivateClientForm clientId={c.id} />}</div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
