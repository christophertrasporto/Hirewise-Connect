import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Check } from "lucide-react";
import { requireActor } from "@/server/auth/require-actor";
import { accessMatrix } from "@/server/services/user-admin.service";
import { MFA_REQUIRED_ROLES } from "@/server/policies/permissions";
import { PageHeader, Card, Banner } from "@/components/app/ui";

export const metadata: Metadata = { title: "Roles and access" };

/** Role × permission matrix straight from the catalog (MASTER_PROMPT Section 7). Read-only. */
export default async function AccessPage() {
  const actor = await requireActor();
  if (!actor.permissions.has("user.manage")) return <Banner tone="warn" title="Requires user.manage">Role administration is for Admins.</Banner>;
  const m = accessMatrix();
  const total = m.groups.reduce((n, g) => n + g.permissions.length, 0);

  return (
    <>
      <Link href="/staff/users" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> Users</Link>
      <PageHeader eyebrow="Administration" title="What each role can do" description={`${total} permissions across ${m.groups.length} areas. A user has one role; a Super Admin can add individual permissions per user, with a reason and an optional expiry.`} />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {m.roles.map((r) => (
          <Card key={r.key} className="!p-4">
            <p className="text-[15px] font-bold text-ink-900">{r.name}</p>
            <p className="mt-0.5 text-[13px] text-ink-500">{r.description}</p>
            <p className="mt-2 text-[12.5px] font-semibold text-brand-700">{r.count} of {total} permissions{MFA_REQUIRED_ROLES.includes(r.key) ? " · authenticator app required" : ""}</p>
          </Card>
        ))}
        {m.ownershipRoles.map((r) => (
          <Card key={r.key} className="!p-4">
            <p className="text-[15px] font-bold text-ink-900">{r.name}</p>
            <p className="mt-0.5 text-[13px] text-ink-500">{r.description}</p>
            <p className="mt-2 text-[12.5px] font-semibold text-ink-500">No catalog permissions: access is to what they own</p>
          </Card>
        ))}
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-ink-100 text-[11.5px] font-semibold uppercase tracking-[0.1em] text-ink-400">
                <th className="py-2 pr-3">Permission</th>
                {m.roles.map((r) => <th key={r.key} className="px-2 py-2 text-center">{r.name.replace(" / Owner", "").replace("Hirewise ", "").replace(" Team", "").replace(" / Trainer", "").replace(" Manager", "")}</th>)}
              </tr>
            </thead>
            <tbody>
              {m.groups.map((g) => (
                <GroupRows key={g.group} group={g.group} rows={g.permissions} roles={m.roles.map((r) => r.key)} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function GroupRows({ group, rows, roles }: { group: string; rows: Array<{ key: string; description: string; roles: readonly string[] }>; roles: string[] }) {
  return (
    <>
      <tr className="bg-ink-50/70"><td colSpan={roles.length + 1} className="py-1.5 pr-3 text-[11.5px] font-semibold uppercase tracking-[0.1em] text-ink-500">{group}</td></tr>
      {rows.map((p) => (
        <tr key={p.key} className="border-b border-ink-50">
          <td className="py-2 pr-3"><span className="font-semibold text-ink-800">{p.key}</span><span className="block text-[12px] text-ink-400">{p.description}</span></td>
          {roles.map((r) => <td key={r} className="px-2 py-2 text-center">{p.roles.includes(r) ? <Check className="mx-auto h-4 w-4 text-brand-600" aria-label="yes" /> : <span className="text-ink-200" aria-label="no">·</span>}</td>)}
        </tr>
      ))}
    </>
  );
}
