import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { listDuplicateFlags, listIdentities } from "@/server/services/identity.service";
import { ForbiddenError } from "@/server/policies/authorize";
import { PageHeader, Card, Banner, EmptyState, StatTile, fmtDate } from "@/components/app/ui";
import { DuplicateFlagCard } from "@/components/identity/DuplicateFlagCard";

export const metadata: Metadata = { title: "Identity" };

const STATUSES = ["OPEN", "APPROVED_NEW_PROFILE", "LINKED", "REJECTED", "ALL"] as const;

/** Identity phase 1: the duplicate-flag queue and the Hirewise-only identity directory. */
export default async function StaffIdentityPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; tab?: string }> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const status = (STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as (typeof STATUSES)[number]) : "OPEN";
  const tab = sp.tab === "identities" ? "identities" : "flags";
  let flags: Awaited<ReturnType<typeof listDuplicateFlags>> | null = null;
  let identities: Awaited<ReturnType<typeof listIdentities>> = [];
  try {
    if (actor.permissions.has("identity.review")) flags = await listDuplicateFlags(prisma, actor, status);
    identities = tab === "identities" ? await listIdentities(prisma, actor, sp.q) : [];
  } catch (e) {
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="Requires identity.read">Platform identities are visible to Hirewise Admins and Recruiters only.</Banner>;
    throw e;
  }
  const counts = flags?.counts ?? {};
  return (
    <>
      <PageHeader eyebrow="Hirewise admin" title="Identity" description="Every talent-type account has one permanent, Hirewise-only platform identity. Sign-ups that match an existing identity become duplicate flags instead of accounts; nothing here is visible to clients or agencies." />
      <div className="mb-6 flex gap-2">
        <Link href="/staff/identity" className={`rounded-full border px-4 py-1.5 text-[13.5px] font-semibold ${tab === "flags" ? "border-ink-900 bg-ink-900 text-white" : "border-ink-200 bg-white text-ink-700 hover:bg-ink-50"}`}>Duplicate flags</Link>
        <Link href="/staff/identity?tab=identities" className={`rounded-full border px-4 py-1.5 text-[13.5px] font-semibold ${tab === "identities" ? "border-ink-900 bg-ink-900 text-white" : "border-ink-200 bg-white text-ink-700 hover:bg-ink-50"}`}>Identities</Link>
      </div>
      {tab === "flags" ? (
        flags ? (
          <>
            <div className="mb-6 grid gap-4 sm:grid-cols-4">
              <StatTile label="Open" value={counts.OPEN ?? 0} href="/staff/identity?status=OPEN" />
              <StatTile label="Approved new profile" value={counts.APPROVED_NEW_PROFILE ?? 0} href="/staff/identity?status=APPROVED_NEW_PROFILE" />
              <StatTile label="Linked" value={counts.LINKED ?? 0} href="/staff/identity?status=LINKED" />
              <StatTile label="Rejected" value={counts.REJECTED ?? 0} href="/staff/identity?status=REJECTED" />
            </div>
            <div className="mb-4 flex flex-wrap gap-2 text-[13px]">
              {STATUSES.map((s) => <Link key={s} href={`/staff/identity?status=${s}`} className={`rounded-full px-3 py-1 font-semibold ${status === s ? "bg-ink-900 text-white" : "bg-white text-ink-600 ring-1 ring-inset ring-ink-200 hover:bg-ink-50"}`}>{s === "ALL" ? "All" : s.replace(/_/g, " ").toLowerCase()}</Link>)}
            </div>
            {flags.rows.length === 0 ? <Card><EmptyState title="No duplicate flags" description="Sign-ups that match an existing email, phone, or identity will appear here for a decision." /></Card> : <div className="space-y-4">{flags.rows.map((f) => <DuplicateFlagCard key={f.id} flag={f} />)}</div>}
          </>
        ) : (
          <Banner tone="info" title="Requires identity.review">Deciding duplicate flags is for Admins. The Identities tab is available to you.</Banner>
        )
      ) : (
        <Card title="Platform identities" description="Search by email, phone, or professional name.">
          <form className="mb-4 flex gap-2" action="/staff/identity">
            <input type="hidden" name="tab" value="identities" />
            <input name="q" defaultValue={sp.q ?? ""} placeholder="Search" className="h-10 flex-1 rounded-xl border border-ink-200 px-3 text-[14px] outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
            <button type="submit" className="rounded-xl bg-ink-900 px-4 text-[13.5px] font-semibold text-white">Search</button>
          </form>
          {identities.length === 0 ? <EmptyState title="No identities match" /> : (
            <table className="w-full text-left text-[14px]">
              <thead className="text-[12px] uppercase tracking-[0.12em] text-ink-400"><tr><th className="pb-3 font-semibold">Identity</th><th className="pb-3 font-semibold">Active profile</th><th className="pb-3 font-semibold">Role</th><th className="pb-3 font-semibold">Profiles</th><th className="pb-3 font-semibold">Flags</th><th className="pb-3 font-semibold">Created</th></tr></thead>
              <tbody className="divide-y divide-ink-100">
                {identities.map((i) => (
                  <tr key={i.id}>
                    <td className="py-3"><Link href={`/staff/identity/${i.id}`} className="font-semibold text-ink-900 hover:text-brand-700">{i.primaryEmail}</Link><span className="block text-[12px] text-ink-400">{i.status.toLowerCase()} · account {i.userStatus.toLowerCase()}</span></td>
                    <td className="py-3 text-ink-700">{i.activeProfile ? `${i.activeProfile.displayName} · ${i.activeProfile.talentType.toLowerCase().replace(/_/g, " ")} · ${i.activeProfile.status.toLowerCase()}` : "—"}</td>
                    <td className="py-3 text-ink-600">{i.role.toLowerCase().replace(/_/g, " ")}</td>
                    <td className="py-3 text-ink-600">{i.profileCount}</td>
                    <td className="py-3 text-ink-600">{i.flagCount}</td>
                    <td className="py-3 text-ink-400">{fmtDate(i.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </>
  );
}
