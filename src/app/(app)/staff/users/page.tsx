import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { listUsersForAdmin } from "@/server/services/admin.service";
import { ForbiddenError } from "@/server/policies/authorize";
import { PageHeader, Card, StatusBadge, EmptyState, Banner, fmtDate } from "@/components/app/ui";
import { Input } from "@/components/ui/Form";
import { AnonymiseForm, BroadcastForm } from "@/components/phase5/AdminTools";
import { IncidentForm } from "@/components/phase5/IncidentForms";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string; user?: string }> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  let rows: Awaited<ReturnType<typeof listUsersForAdmin>>;
  try {
    rows = await listUsersForAdmin(prisma, actor, sp.q);
  } catch (e) {
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="Requires user.manage">User administration is for Admins.</Banner>;
    throw e;
  }
  const focus = sp.user ? rows.find((r) => r.id === sp.user) : null;
  return (
    <>
      <PageHeader eyebrow="Administration" title="Users" description="Search accounts, open an incident against a user, anonymise on request (Q18), or broadcast a notification." actions={<form method="get" className="flex gap-2"><Input name="q" defaultValue={sp.q ?? ""} placeholder="Search by email" className="h-10 w-[240px] text-[13.5px]" /><button type="submit" className="h-10 rounded-full bg-ink-900 px-4 text-[13.5px] font-semibold text-white">Search</button></form>} />
      <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          {rows.length === 0 ? <EmptyState title="No users match" /> : (
            <ul className="divide-y divide-ink-100">
              {rows.map((u) => (
                <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-[14px]">
                  <div>
                    <p className="font-semibold text-ink-900">{u.agentProfile ? <Link href={`/staff/talent/${u.agentProfile.id}`} className="hover:text-brand-700">{u.agentProfile.displayName}</Link> : u.clientContact?.client.companyName ?? u.email} <span className="font-normal text-ink-400">· {u.role.key.toLowerCase()}</span></p>
                    <p className="text-[12.5px] text-ink-400">{u.email} · joined {fmtDate(u.createdAt)}{u.lastLoginAt ? ` · last login ${fmtDate(u.lastLoginAt)}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-2"><StatusBadge status={u.status} /><Link href={`/staff/users?${sp.q ? `q=${encodeURIComponent(sp.q)}&` : ""}user=${u.id}`} className="text-[12.5px] font-semibold text-brand-600">Manage</Link></div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="space-y-5">
          {focus && (
            <Card title={`Manage ${focus.email}`} description={`${focus.role.key.toLowerCase()} · ${focus.status.toLowerCase()}`}>
              <div className="space-y-5">
                <div><p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Open an incident</p><IncidentForm subjectUserId={focus.id} subjectLabel={focus.email} compact /></div>
                {focus.role.key !== "SUPER_ADMIN" && <div className="border-t border-ink-100 pt-4"><p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Deletion request</p><AnonymiseForm userId={focus.id} label={focus.email} /></div>}
              </div>
            </Card>
          )}
          {actor.permissions.has("notification.broadcast") && <Card title="Broadcast notification" description="In-app for every active user in the chosen roles, optionally by email."><BroadcastForm /></Card>}
        </div>
      </div>
    </>
  );
}
