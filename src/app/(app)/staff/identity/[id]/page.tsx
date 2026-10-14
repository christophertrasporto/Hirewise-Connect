import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { identityForStaff } from "@/server/services/identity.service";
import { ForbiddenError, NotFoundError } from "@/server/policies/authorize";
import { PageHeader, Card, Banner, StatusBadge, fmtDate } from "@/components/app/ui";

export const metadata: Metadata = { title: "Platform identity" };

/** Identity phase 1: the full, Hirewise-only history behind one person. */
export default async function IdentityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  let r: Awaited<ReturnType<typeof identityForStaff>>;
  try {
    r = await identityForStaff(prisma, actor, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="Requires identity.read">Platform identities are visible to Hirewise Admins and Recruiters only.</Banner>;
    throw e;
  }
  return (
    <>
      <PageHeader eyebrow="Platform identity" title={r.primaryEmail} description={`Account ${r.user.status.toLowerCase()} · ${r.user.role.toLowerCase().replace(/_/g, " ")} · identity ${r.status.toLowerCase()} · created ${fmtDate(r.createdAt)}${r.user.lastLoginAt ? ` · last login ${fmtDate(r.user.lastLoginAt)}` : ""}`} />
      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <Card title="Contacts" description="Normalised values used for duplicate detection. Never shown outside Hirewise.">
          <ul className="divide-y divide-ink-100 text-[14px]">
            {r.contacts.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                <span><span className="font-semibold text-ink-900">{c.value}</span> <span className="text-ink-400">· {c.kind.toLowerCase()} · {c.source.toLowerCase().replace(/_/g, " ")}</span></span>
                <span className="text-[12.5px] text-ink-400">{c.verifiedAt ? `verified ${fmtDate(c.verifiedAt)}` : "unverified"}</span>
              </li>
            ))}
          </ul>
          {r.notes && <p className="mt-3 text-[13px] text-ink-600">Notes: {r.notes}</p>}
        </Card>
        <Card title="Duplicate flags" description="Sign-ups that matched this identity.">
          {r.duplicateFlags.length === 0 ? <p className="text-[13.5px] text-ink-400">None.</p> : (
            <ul className="divide-y divide-ink-100 text-[13.5px]">
              {r.duplicateFlags.map((f) => <li key={f.id} className="py-2"><span className="font-semibold text-ink-900">{f.attemptedEmail}</span> <span className="text-ink-400">· {f.kind.toLowerCase().replace(/_/g, " ")} · {f.matchReasons.join(", ").toLowerCase()} · {fmtDate(f.createdAt)}</span> <StatusBadge status={f.status} /></li>)}
            </ul>
          )}
        </Card>
      </div>
      <div className="mt-5 space-y-5">
        {r.profiles.map((p) => (
          <Card key={p.id} title={<span>{p.displayName} <span className="text-[13px] font-normal text-ink-400">· {p.talentType.toLowerCase().replace(/_/g, " ")} · {p.active ? "active profile" : `archived ${fmtDate(p.archivedAt)}`}</span></span>} description={`Status ${p.status.toLowerCase().replace(/_/g, " ")} · created ${fmtDate(p.createdAt)}${p.primaryAgency ? ` · primary agency ${p.primaryAgency.name}` : " · Hirewise Direct"}`} actions={<Link href={`/staff/talent/${p.id}`} className="text-[13px] font-semibold text-brand-700 hover:underline">Open profile</Link>}>
            <div className="grid gap-4 text-[13.5px] md:grid-cols-2">
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Memberships</p>
                {p.memberships.length === 0 ? <p className="text-ink-400">None.</p> : <ul className="mt-1 space-y-1">{p.memberships.map((m) => <li key={m.id}>{m.agency?.name ?? "Hirewise Direct"} · {m.status.toLowerCase()} · {fmtDate(m.joinedAt)}{m.leftAt ? ` to ${fmtDate(m.leftAt)}` : ""}{m.endReason ? ` · ${m.endReason}` : ""}</li>)}</ul>}
                <p className="mt-3 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Placements</p>
                {p.placements.length === 0 ? <p className="text-ink-400">None.</p> : <ul className="mt-1 space-y-1">{p.placements.map((pl) => <li key={pl.id}>{pl.positionTitle} · {pl.status.toLowerCase()}{pl.startDate ? ` · from ${fmtDate(pl.startDate)}` : ""}{pl.endedAt ? ` to ${fmtDate(pl.endedAt)}` : ""}</li>)}</ul>}
              </div>
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Certifications</p>
                {p.certifications.length === 0 ? <p className="text-ink-400">None.</p> : <ul className="mt-1 space-y-1">{p.certifications.map((c) => <li key={c.id}>{c.name} · {c.status.toLowerCase().replace(/_/g, " ")} · {fmtDate(c.issuedAt)}</li>)}</ul>}
                <p className="mt-3 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Courses</p>
                {p.enrollments.length === 0 ? <p className="text-ink-400">None.</p> : <ul className="mt-1 space-y-1">{p.enrollments.map((e) => <li key={e.id}>{e.courseTitle} · {e.status.toLowerCase()} · {e.source.toLowerCase().replace(/_/g, " ")}</li>)}</ul>}
              </div>
            </div>
          </Card>
        ))}
        {r.profiles.length === 0 && <Card><p className="text-[13.5px] text-ink-400">No talent profile yet (applicant account).</p></Card>}
      </div>
    </>
  );
}
