import type { Metadata } from "next";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { listOwnRequirements } from "@/server/services/requirement.service";
import { getOwnClient } from "@/server/services/client.service";
import { taxonomyRepository } from "@/server/repositories/taxonomy.repository";
import { PageHeader, Card, StatusBadge, EmptyState, fmtDate } from "@/components/app/ui";
import { RequirementForm } from "@/components/interviews/RequirementForm";

export const metadata: Metadata = { title: "Hiring requirements" };

export default async function RequirementsPage() {
  const actor = await requireActor();
  const [rows, client, skills, software] = await Promise.all([listOwnRequirements(prisma, actor), getOwnClient(prisma, actor), taxonomyRepository.activeSkills(prisma), taxonomyRepository.activeSoftware(prisma)]);
  return (
    <>
      <PageHeader eyebrow="Requirements" title="Hiring requirements" description="Describe what you need. Hirewise uses this to recommend candidates and to brief them once interviews are scheduled." />
      <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr]">
        <Card title="Your requirements">
          {rows.length === 0 ? <EmptyState title="No requirements yet" /> : (
            <ul className="divide-y divide-ink-100">
              {rows.map((r) => (
                <li key={r.id} className="py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[15px] font-semibold text-ink-900">{r.title}</p>
                    <StatusBadge status={r.status} />
                  </div>
                  <p className="text-[12.5px] text-ink-400">{r.role} · {r.agentsRequired} agent(s){r.schedule ? ` · ${r.schedule}` : ""} · start {fmtDate(r.startDate)}</p>
                  {r.skills.length > 0 && <p className="mt-1 text-[13px] text-ink-500">Skills: {r.skills.join(", ")}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="New requirement">
          <RequirementForm skills={skills.map((s) => ({ id: s.id, name: s.name }))} software={software.map((s) => ({ id: s.id, name: s.name }))} defaultTimezone={client.timezone ?? "America/Los_Angeles"} />
        </Card>
      </div>
    </>
  );
}
