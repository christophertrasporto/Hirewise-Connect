import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { compareShortlisted } from "@/server/services/shortlist.service";
import { PageHeader, EmptyState, StatusBadge } from "@/components/app/ui";
import { labelFor } from "@/lib/options";

export const metadata: Metadata = { title: "Compare candidates" };

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const actor = await requireActor();
  const { ids } = await searchParams;
  const rows = await compareShortlisted(prisma, actor, (ids ?? "").split(",").filter(Boolean));

  const lines: Array<{ label: string; render: (c: (typeof rows)[number]) => React.ReactNode }> = [
    { label: "Role", render: (c) => c.primaryRole ?? "—" },
    { label: "Experience", render: (c) => `${c.yearsExperience ?? 0} yrs · ${c.experienceLevel ? labelFor(c.experienceLevel) : "—"}` },
    { label: "Verification", render: (c) => <StatusBadge status={c.verificationLevel} /> },
    { label: "Availability", render: (c) => <StatusBadge status={c.availabilityStatus} /> },
    { label: "Timezone", render: (c) => c.timezone ?? "—" },
    { label: "Setup · shift", render: (c) => `${c.workSetup ? labelFor(c.workSetup) : "—"}${c.preferredShift ? ` · ${c.preferredShift}` : ""}` },
    { label: "Languages", render: (c) => c.languages.join(", ") || "—" },
    { label: "Skills", render: (c) => <span className="text-[13px]">{c.skills.map((s) => `${s.name} (${labelFor(s.level)})`).join(", ") || "—"}</span> },
    { label: "Software", render: (c) => <span className="text-[13px]">{c.software.map((s) => s.name).join(", ") || "—"}</span> },
    { label: "Industries", render: (c) => c.industries.map((i) => `${i.industry} ${i.years}y`).join(", ") || "—" },
    { label: "Campaign experience", render: (c) => (c.experiences.some((e) => e.isCampaign) ? "Yes" : "No") },
    { label: "Approved video", render: (c) => (c.videos.length ? "Yes" : "No") },
    { label: "Approved voice samples", render: (c) => String(c.recordings.length) },
    { label: "Certifications", render: () => <span className="text-ink-400">Phase 3</span> },
    { label: "Assessment result", render: () => <span className="text-ink-400">Phase 3</span> },
    { label: "Client rate", render: () => "Set by Hirewise" },
  ];

  return (
    <>
      <Link href="/shortlist" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> Back to shortlist</Link>
      <PageHeader eyebrow="Compare" title="Side by side" description="Up to four shortlisted candidates on the evidence Hirewise has verified." />
      {rows.length < 2 ? (
        <EmptyState title="Pick at least two shortlisted candidates to compare" />
      ) : (
        <div className="overflow-x-auto rounded-3xl border border-ink-100 bg-white shadow-soft">
          <table className="w-full min-w-[720px] text-left text-[14px]">
            <thead>
              <tr className="border-b border-ink-100">
                <th className="w-44 p-4" />
                {rows.map((c) => (
                  <th key={c.id} className="p-4 align-top">
                    <Link href={`/talent/${c.id}`} className="text-[16px] font-bold text-ink-900 hover:text-brand-700">{c.displayName}</Link>
                    <p className="mt-0.5 text-[12.5px] font-normal text-ink-500">{c.headline}</p>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {lines.map((l) => (
                <tr key={l.label}>
                  <th className="p-4 text-left text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400 align-top">{l.label}</th>
                  {rows.map((c) => <td key={c.id} className="p-4 align-top text-ink-700">{l.render(c)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
