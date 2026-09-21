import Link from "next/link";
import { PageHeader, Card, StatusBadge, Banner, EmptyState, fmtDate } from "@/components/app/ui";
import { NotificationList } from "@/components/app/NotificationList";
import type { toClientSelfView } from "@/server/views/client.views";

type Props = { client: ReturnType<typeof toClientSelfView>; notifications: Array<{ id: string; title: string; body: string; readAt: Date | null; createdAt: Date }> };

export function ClientDashboard({ client, notifications }: Props) {
  const pending = client.status === "PENDING_REVIEW";
  return (
    <>
      <PageHeader eyebrow="Client dashboard" title={client.companyName} description="Discover verified talent, shortlist, and request interviews. Hirewise handles pricing, contracts, and deployment." actions={<StatusBadge status={client.status} />} />

      {pending && (
        <div className="mb-6">
          <Banner tone="warn" title="Your account is being reviewed by Hirewise">
            A member of the Sales team reviews every new client, usually within one business day. The talent marketplace opens as soon as your account is active. You can update your company details meanwhile.
          </Banner>
        </div>
      )}
      {client.status === "SUSPENDED" && <div className="mb-6"><Banner tone="danger" title="Account suspended">Contact Hirewise to resolve this.</Banner></div>}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Your requirement" className="lg:col-span-2" actions={<Link href="/company" className="text-[13px] font-semibold text-brand-600">Edit</Link>}>
          {client.onboarding ? (
            <dl className="grid gap-4 sm:grid-cols-2">
              <Item k="Services needed" v={client.onboarding.servicesNeeded.join(", ") || "—"} />
              <Item k="Agents required" v={String(client.onboarding.agentsRequired ?? "—")} />
              <Item k="Preferred schedule" v={client.onboarding.preferredSchedule ?? "—"} />
              <Item k="Expected start" v={fmtDate(client.onboarding.expectedStartDate)} />
              <Item k="Timezone" v={client.timezone ?? "—"} />
              <Item k="Industry" v={client.industry ?? "—"} />
            </dl>
          ) : (
            <EmptyState title="No requirement yet" />
          )}
        </Card>
        <div className="space-y-5">
          <Card title="Talent marketplace">
            <EmptyState title={pending ? "Opens after activation" : "Search arrives in Phase 1B"} description={pending ? "Hirewise is reviewing your account." : "Evidence-based search, shortlists, and comparison are next."} />
          </Card>
          <Card title="Shortlists">
            <EmptyState title="No shortlists yet" />
          </Card>
        </div>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <Card title="Interviews and placements">
          <EmptyState title="Nothing scheduled" description="Interview requests, selections, contracts, and deposits appear here as they happen." />
        </Card>
        <Card title="Notifications" actions={<Link href="/notifications" className="text-[13px] font-semibold text-brand-600">View all</Link>}>
          <NotificationList items={notifications.slice(0, 5)} compact />
        </Card>
      </div>
    </>
  );
}

function Item({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">{k}</dt>
      <dd className="mt-0.5 text-[14.5px] font-medium text-ink-800">{v}</dd>
    </div>
  );
}
