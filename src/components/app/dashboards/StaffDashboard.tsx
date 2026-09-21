import Link from "next/link";
import { PageHeader, Card, StatTile, EmptyState, fmtDate } from "@/components/app/ui";
import { NotificationList } from "@/components/app/NotificationList";
import { ROLE_NAMES, type RoleKey } from "@/server/policies/permissions";
import type { staffDashboard } from "@/server/services/dashboard.service";

type Props = { role: RoleKey; email: string; stats: Awaited<ReturnType<typeof staffDashboard>>; notifications: Array<{ id: string; title: string; body: string; readAt: Date | null; createdAt: Date }> };

export function StaffDashboard({ role, stats, notifications }: Props) {
  const tasks = [...stats.tasks.mine, ...stats.tasks.queue.filter((q) => !stats.tasks.mine.some((m) => m.id === q.id))];
  return (
    <>
      <PageHeader eyebrow={ROLE_NAMES[role].name} title="Operations overview" description="Live counts across talent, clients, review queues, and your follow-up tasks." />

      {stats.visibility.agents && (
        <section className="mb-6">
          <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.16em] text-ink-400">Talent</h2>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile label="Total agents" value={stats.agents.total} href="/staff/talent" />
            <StatTile label="Approved" value={stats.agents.approved} href="/staff/talent?status=APPROVED" />
            <StatTile label="Pending review" value={stats.agents.pending} href="/staff/talent?status=SUBMITTED" />
            <StatTile label="Revision" value={stats.agents.revision} href="/staff/talent?status=REVISION_REQUIRED" />
            <StatTile label="Drafts" value={stats.agents.draft} href="/staff/talent?status=DRAFT" />
            <StatTile label="Available" value={stats.agents.available} hint="Approved and available" />
          </div>
        </section>
      )}

      {stats.visibility.clients && (
        <section className="mb-6">
          <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.16em] text-ink-400">Clients</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile label="Total clients" value={stats.clients.total} href="/staff/clients" />
            <StatTile label="Awaiting activation" value={stats.clients.pending} href="/staff/clients?status=PENDING_REVIEW" />
            <StatTile label="Active" value={stats.clients.active} href="/staff/clients?status=ACTIVE" />
          </div>
        </section>
      )}

      {stats.visibility.media && (
        <section className="mb-6">
          <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.16em] text-ink-400">Media review</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <StatTile label="Videos awaiting approval" value={stats.media.videosPending} hint="Review from the agent's profile" />
            <StatTile label="Recordings awaiting approval" value={stats.media.recordingsPending} hint="Review from the agent's profile" />
          </div>
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Follow-up tasks" description="Your tasks plus the queue for your role.">
          {tasks.length === 0 ? (
            <EmptyState title="No open tasks" />
          ) : (
            <ul className="divide-y divide-ink-100">
              {tasks.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="text-[14.5px] font-medium text-ink-800">{t.title}</p>
                    <p className="text-[12.5px] text-ink-400">{t.type.replace(/_/g, " ").toLowerCase()} · due {fmtDate(t.dueAt)}</p>
                  </div>
                  {t.relatedType === "Client" && t.relatedId && <Link href="/staff/clients?status=PENDING_REVIEW" className="text-[13px] font-semibold text-brand-600">Open</Link>}
                  {t.relatedType === "AgentProfile" && t.relatedId && <Link href={`/staff/talent/${t.relatedId}`} className="text-[13px] font-semibold text-brand-600">Open</Link>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Notifications" actions={<Link href="/notifications" className="text-[13px] font-semibold text-brand-600">View all</Link>}>
          <NotificationList items={notifications.slice(0, 6)} compact />
        </Card>
      </div>
    </>
  );
}
