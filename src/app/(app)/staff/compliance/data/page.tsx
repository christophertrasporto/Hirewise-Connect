import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { retentionCandidates } from "@/server/services/admin.service";
import { ForbiddenError } from "@/server/policies/authorize";
import { PageHeader, Card, EmptyState, Banner, fmtDate } from "@/components/app/ui";
import { RetentionRunButton, AnonymiseForm } from "@/components/phase5/AdminTools";

export const metadata: Metadata = { title: "Data protection" };

export default async function DataProtectionPage() {
  const actor = await requireActor();
  let data: Awaited<ReturnType<typeof retentionCandidates>>;
  try {
    data = await retentionCandidates(prisma, actor);
  } catch (e) {
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="Requires user.manage">Data protection tooling is for Admins.</Banner>;
    throw e;
  }
  return (
    <>
      <PageHeader eyebrow="Compliance" title="Data protection" description={`Section 14 Q18: soft-deleted, deactivated, or suspended talent and client accounts inactive for more than ${data.retentionDays} days (Setting retentionDays) are anonymised by this admin-run job. Deletion requests are handled per user from Staff → Users.`} actions={<Link href="/staff/users" className="rounded-full border border-ink-200 bg-white px-4 py-1.5 text-[13.5px] font-semibold text-ink-700">Users</Link>} />
      <Card title="Retention candidates" description={`Inactive since before ${fmtDate(data.cutoff)}. Anonymisation keeps commercial and audit records but removes personal data and media.`} actions={<RetentionRunButton count={data.candidates.length} />}>
        {data.candidates.length === 0 ? <EmptyState title="Nothing due" /> : (
          <ul className="divide-y divide-ink-100">
            {data.candidates.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-[14px]">
                <span><span className="font-semibold text-ink-900">{c.email}</span> <span className="text-ink-400">· {c.role.toLowerCase()} · {c.status.toLowerCase()} since {fmtDate(c.since)}</span></span>
                <AnonymiseForm userId={c.id} label={c.email} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
