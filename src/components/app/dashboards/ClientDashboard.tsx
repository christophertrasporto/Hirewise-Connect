import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PageHeader, Card, StatusBadge, Banner, EmptyState, StatTile, fmtDate } from "@/components/app/ui";
import { NotificationList } from "@/components/app/NotificationList";
import { CandidateCard } from "@/components/marketplace/CandidateCard";
import type { toClientSelfView } from "@/server/views/client.views";
import type { CandidateCardView } from "@/server/views/agent.views";

type Props = {
  client: ReturnType<typeof toClientSelfView>;
  notifications: Array<{ id: string; title: string; body: string; readAt: Date | null; createdAt: Date }>;
  recommended: CandidateCardView[];
  recentlyViewed: CandidateCardView[];
  shortlistCount: number;
  openRequests: number;
  decisionsPending: number;
  upcoming: Array<{ id: string; requestId: string; displayName: string; scheduledAt: Date; timezone: string }>;
  placements: Array<{ id: string; status: string; positionTitle: string; displayName: string }>;
};

export function ClientDashboard({ client, notifications, recommended, recentlyViewed, shortlistCount, openRequests, decisionsPending, upcoming, placements }: Props) {
  const pending = client.status === "PENDING_REVIEW";
  return (
    <>
      <PageHeader eyebrow="Client dashboard" title={client.companyName} description="Discover verified talent, shortlist, and request interviews. Hirewise handles pricing, contracts, and deployment." actions={<StatusBadge status={client.status} />} />

      {pending && (
        <div className="mb-6">
          <Banner tone="warn" title="Your account is being reviewed by Hirewise">A member of the Sales team reviews every new client, usually within one business day. The talent marketplace opens as soon as your account is active.</Banner>
        </div>
      )}
      {client.status === "SUSPENDED" && <div className="mb-6"><Banner tone="danger" title="Account suspended">Contact Hirewise to resolve this.</Banner></div>}

      {!pending && (
        <div className="mb-6 grid gap-3 sm:grid-cols-4">
          <StatTile label="Shortlisted" value={shortlistCount} href="/shortlist" />
          <StatTile label="Open interview requests" value={openRequests} href="/interviews" hint={decisionsPending ? `${decisionsPending} awaiting your decision` : undefined} />
          <StatTile label="Selected candidates" value={placements.filter((p) => p.status !== "CANCELLED" && p.status !== "COMPLETED").length} href="/placements" />
          <StatTile label="Active agents" value={placements.filter((p) => p.status === "ACTIVE").length} href="/placements" hint={placements.some((p) => p.status === "AWAITING_AGREEMENT" || p.status === "AWAITING_DEPOSIT") ? "Action needed on a placement" : undefined} />
        </div>
      )}

      {!pending && (
        <Card title="Recommended for you" description="Newest approved candidates matching the services you asked for." className="mb-6" actions={<Link href="/talent" className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand-600">Search all <ArrowRight className="h-3.5 w-3.5" /></Link>}>
          {recommended.length === 0 ? <EmptyState title="No matching candidates yet" description="Hirewise adds approved talent continuously." /> : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{recommended.map((c) => <CandidateCard key={c.id} c={c} />)}</div>
          )}
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Your requirement" className="lg:col-span-2" actions={<Link href="/company" className="text-[13px] font-semibold text-brand-600">Details</Link>}>
          {client.onboarding ? (
            <dl className="grid gap-4 sm:grid-cols-3">
              <Item k="Services needed" v={client.onboarding.servicesNeeded.join(", ") || "—"} />
              <Item k="Agents required" v={String(client.onboarding.agentsRequired ?? "—")} />
              <Item k="Preferred schedule" v={client.onboarding.preferredSchedule ?? "—"} />
              <Item k="Expected start" v={fmtDate(client.onboarding.expectedStartDate)} />
              <Item k="Timezone" v={client.timezone ?? "—"} />
              <Item k="Industry" v={client.industry ?? "—"} />
            </dl>
          ) : <EmptyState title="No requirement yet" />}
        </Card>
        <Card title="Recently viewed">
          {recentlyViewed.length === 0 ? <EmptyState title="Nothing viewed yet" /> : (
            <ul className="divide-y divide-ink-100">
              {recentlyViewed.map((c) => (
                <li key={c.id} className="py-2.5">
                  <Link href={`/talent/${c.id}`} className="text-[14.5px] font-semibold text-ink-900 hover:text-brand-700">{c.displayName}</Link>
                  <p className="text-[12.5px] text-ink-500">{c.primaryRole ?? "—"}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <Card title="Upcoming interviews" actions={<Link href="/interviews" className="text-[13px] font-semibold text-brand-600">All requests</Link>}>
          {upcoming.length === 0 ? <EmptyState title="No interviews scheduled" description="Request interviews from your shortlist; Hirewise coordinates the rest." /> : (
            <ul className="divide-y divide-ink-100 text-[13.5px]">
              {upcoming.map((i) => (
                <li key={i.id} className="flex items-center justify-between py-2.5">
                  <Link href={`/interviews/${i.requestId}`} className="font-semibold text-ink-800 hover:text-brand-700">{i.displayName}</Link>
                  <span className="text-ink-500">{new Date(i.scheduledAt).toLocaleString("en-US", { timeZone: i.timezone, dateStyle: "medium", timeStyle: "short" })}</span>
                </li>
              ))}
            </ul>
          )}
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
