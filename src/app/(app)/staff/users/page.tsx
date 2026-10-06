import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { listUsersForAdmin } from "@/server/services/admin.service";
import { getUserAccess, permissionGroups, STAFF_ROLES } from "@/server/services/user-admin.service";
import { ROLE_NAMES, PERMISSIONS } from "@/server/policies/permissions";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { PageHeader, Card, StatusBadge, EmptyState, Banner, fmtDate } from "@/components/app/ui";
import { Input } from "@/components/ui/Form";
import { AnonymiseForm, BroadcastForm } from "@/components/phase5/AdminTools";
import { IncidentForm } from "@/components/phase5/IncidentForms";
import { ChangeRoleForm, GrantOverrideForm, InviteStaffForm, OverrideList, ResendInviteButton, UserStatusForm } from "@/components/admin/UserAdminPanels";

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
  const canRbac = actor.permissions.has("rbac.manage");
  const roleOptions = STAFF_ROLES.filter((r) => canRbac || r !== "SUPER_ADMIN").map((key) => ({ key, name: ROLE_NAMES[key].name }));

  let focus: Awaited<ReturnType<typeof getUserAccess>> | null = null;
  if (sp.user) {
    try {
      focus = await getUserAccess(prisma, actor, sp.user);
    } catch (e) {
      if (!(e instanceof NotFoundError)) throw e;
    }
  }
  const grantable = focus ? focus.grantable.map((key) => ({ key, group: PERMISSIONS[key].group, description: PERMISSIONS[key].description })) : [];
  const groups = permissionGroups();
  const backQuery = sp.q ? `q=${encodeURIComponent(sp.q)}&` : "";

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Users"
        description="Invite staff, set roles and extra permissions, suspend or reinstate, open incidents, anonymise on request, or broadcast."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/staff/users/access" className="inline-flex h-10 items-center gap-1.5 rounded-full border border-ink-200 bg-white px-4 text-[13.5px] font-semibold text-ink-700 hover:border-brand-300 hover:text-brand-700"><KeyRound className="h-4 w-4" /> What each role can do</Link>
            <form method="get" className="flex gap-2"><Input name="q" defaultValue={sp.q ?? ""} placeholder="Search by email" className="h-10 w-[220px] text-[13.5px]" /><button type="submit" className="h-10 rounded-full bg-ink-900 px-4 text-[13.5px] font-semibold text-white">Search</button></form>
          </div>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-5">
          <Card>
            {rows.length === 0 ? <EmptyState title="No users match" /> : (
              <ul className="divide-y divide-ink-100">
                {rows.map((u) => (
                  <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-[14px]">
                    <div>
                      <p className="font-semibold text-ink-900">{u.agentProfile ? <Link href={`/staff/talent/${u.agentProfile.id}`} className="hover:text-brand-700">{u.agentProfile.displayName}</Link> : u.clientContact?.client.companyName ?? u.email} <span className="font-normal text-ink-400">· {ROLE_NAMES[u.role.key as keyof typeof ROLE_NAMES]?.name ?? u.role.key.toLowerCase()}</span></p>
                      <p className="text-[12.5px] text-ink-400">{u.email} · joined {fmtDate(u.createdAt)}{u.lastLoginAt ? ` · last login ${fmtDate(u.lastLoginAt)}` : " · never signed in"}</p>
                    </div>
                    <div className="flex items-center gap-2"><StatusBadge status={u.status} /><Link href={`/staff/users?${backQuery}user=${u.id}`} className={`text-[12.5px] font-semibold ${focus?.id === u.id ? "text-ink-900" : "text-brand-600"}`}>Manage</Link></div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Invite a staff member" description="Creates the account and emails a set-password link. Talent and clients register themselves.">
            <InviteStaffForm roles={roleOptions} />
          </Card>
        </div>
        <div className="space-y-5">
          {focus && (
            <Card title={`Manage ${focus.email}`} description={`${focus.roleName} · ${focus.status.toLowerCase()}${focus.mfaEnabled ? " · MFA on" : ""}${!focus.hasPassword ? " · no password yet" : ""}`}>
              <div className="space-y-6">
                {focus.isStaff && (
                  <section>
                    <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Role</p>
                    {canRbac && focus.id !== actor.userId ? <ChangeRoleForm userId={focus.id} currentRole={focus.role} roles={roleOptions} /> : <p className="text-[13.5px] text-ink-600">{focus.roleName}{focus.id === actor.userId ? " (your own account; another Super Admin can change it)" : canRbac ? "" : ". Only a Super Admin can change roles."}</p>}
                  </section>
                )}
                {!focus.isStaff && <section><p className="mb-1 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Role</p><p className="text-[13.5px] text-ink-600">{focus.roleName}. Talent and client accounts keep their role; their access is based on what they own.</p></section>}

                <section>
                  <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Access</p>
                  <p className="text-[13.5px] text-ink-600">{focus.isStaff ? `${focus.effective.length} permission${focus.effective.length === 1 ? "" : "s"}: ${focus.rolePermissions.length} from the role${focus.overrides.filter((o) => !o.expired).length ? ` plus ${focus.overrides.filter((o) => !o.expired).length} extra` : ""}.` : "Ownership-based: their own profile, records, and anything explicitly shared with them."}</p>
                  {focus.isStaff && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[13px] font-semibold text-brand-700">Show effective permissions</summary>
                      <div className="mt-2 space-y-2">
                        {groups.map((g) => {
                          const mine = g.permissions.filter((p) => focus!.effective.includes(p.key));
                          if (mine.length === 0) return null;
                          return <div key={g.group}><p className="text-[11.5px] font-semibold uppercase tracking-[0.1em] text-ink-400">{g.group}</p><div className="mt-1 flex flex-wrap gap-1.5">{mine.map((p) => <span key={p.key} title={p.description} className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ring-1 ring-inset ${focus!.rolePermissions.includes(p.key) ? "bg-ink-50 text-ink-700 ring-ink-200" : "bg-gold-50 text-gold-800 ring-gold-200"}`}>{p.key}</span>)}</div></div>;
                        })}
                      </div>
                    </details>
                  )}
                </section>

                {focus.isStaff && (
                  <section>
                    <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Extra permissions</p>
                    <OverrideList overrides={focus.overrides} canRevoke={canRbac} />
                    {canRbac && <div className="mt-3 border-t border-ink-100 pt-3"><GrantOverrideForm userId={focus.id} permissions={grantable} /></div>}
                    {!canRbac && <p className="mt-2 text-[12.5px] text-ink-400">Only a Super Admin grants extra permissions.</p>}
                  </section>
                )}

                {focus.role !== "SUPER_ADMIN" && focus.id !== actor.userId && (
                  <section className="border-t border-ink-100 pt-4">
                    <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Account status</p>
                    <UserStatusForm userId={focus.id} status={focus.status} email={focus.email} />
                  </section>
                )}
                {focus.isStaff && !focus.hasPassword && focus.status === "ACTIVE" && (
                  <section className="border-t border-ink-100 pt-4">
                    <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Invitation</p>
                    <ResendInviteButton userId={focus.id} />
                  </section>
                )}

                <section className="border-t border-ink-100 pt-4"><p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Open an incident</p><IncidentForm subjectUserId={focus.id} subjectLabel={focus.email} compact /></section>
                {focus.role !== "SUPER_ADMIN" && <section className="border-t border-ink-100 pt-4"><p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Deletion request</p><AnonymiseForm userId={focus.id} label={focus.email} /></section>}
              </div>
            </Card>
          )}
          {!focus && <Card title="Manage a user" description="Pick Manage next to an account to change its role, grant extra permissions, suspend, or anonymise."><p className="text-[13.5px] text-ink-500">Roles: {STAFF_ROLES.map((r) => ROLE_NAMES[r].name).join(", ")}. See <Link href="/staff/users/access" className="font-semibold text-brand-600">what each role can do</Link>.</p></Card>}
          {actor.permissions.has("notification.broadcast") && <Card title="Broadcast notification" description="In-app for every active user in the chosen roles, optionally by email."><BroadcastForm /></Card>}
        </div>
      </div>
    </>
  );
}
