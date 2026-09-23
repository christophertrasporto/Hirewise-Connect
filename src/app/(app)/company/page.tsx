import type { Metadata } from "next";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { getOwnClient } from "@/server/services/client.service";
import { PageHeader, Card, StatusBadge, fmtDate } from "@/components/app/ui";

export const metadata: Metadata = { title: "Company" };

export default async function CompanyPage() {
  const actor = await requireActor();
  const c = await getOwnClient(prisma, actor);
  return (
    <>
      <PageHeader eyebrow="Company" title={c.companyName} actions={<><StatusBadge status={c.status} /><a href="/api/export/client" className="rounded-full border border-ink-200 bg-white px-4 py-1.5 text-[13.5px] font-semibold text-ink-700 hover:bg-ink-50">Export my data (JSON)</a></>} description="What Hirewise knows about your company and your hiring need. Requirements are managed under Requirements; your data export includes everything you can see here." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Company">
          <dl className="grid gap-4 sm:grid-cols-2">
            <Item k="Industry" v={c.industry ?? "—"} />
            <Item k="Website" v={c.website ?? "—"} />
            <Item k="Country" v={c.country ?? "—"} />
            <Item k="Timezone" v={c.timezone ?? "—"} />
            <Item k="Registered" v={fmtDate(c.createdAt)} />
            <Item k="Account manager" v={c.accountManagerAssigned ? "Assigned" : "Pending"} />
          </dl>
        </Card>
        <Card title="Primary contact">
          <dl className="grid gap-4 sm:grid-cols-2">
            <Item k="Name" v={c.contact?.name ?? "—"} />
            <Item k="Position" v={c.contact?.position ?? "—"} />
            <Item k="Business email" v={c.contact?.businessEmail ?? "—"} />
            <Item k="Phone" v={c.contact?.phone ?? "—"} />
          </dl>
        </Card>
        <Card title="Hiring need" className="lg:col-span-2">
          <dl className="grid gap-4 sm:grid-cols-3">
            <Item k="Services" v={c.onboarding?.servicesNeeded.join(", ") || "—"} />
            <Item k="Agents required" v={String(c.onboarding?.agentsRequired ?? "—")} />
            <Item k="Preferred schedule" v={c.onboarding?.preferredSchedule ?? "—"} />
            <Item k="Expected start" v={fmtDate(c.onboarding?.expectedStartDate)} />
            <div className="sm:col-span-2"><Item k="Notes" v={c.onboarding?.notes ?? "—"} /></div>
          </dl>
        </Card>
      </div>
    </>
  );
}

function Item({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">{k}</dt>
      <dd className="mt-0.5 text-[14.5px] font-medium break-words text-ink-800">{v}</dd>
    </div>
  );
}
