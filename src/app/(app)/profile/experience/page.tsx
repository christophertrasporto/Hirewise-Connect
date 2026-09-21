import type { Metadata } from "next";
import { Trash2 } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { getOwnProfile } from "@/server/services/agent.service";
import { PageHeader, Card, EmptyState, fmtDate } from "@/components/app/ui";
import { ExperienceForm } from "@/components/profile/ExperienceForm";
import { removeExperienceAction } from "@/app/(app)/actions";

export const metadata: Metadata = { title: "Work experience" };

export default async function ExperiencePage() {
  const actor = await requireActor();
  const p = await getOwnProfile(prisma, actor);
  return (
    <>
      <PageHeader title="Work experience" description="Roles and campaigns you have worked. Mark campaign work so clients can filter by campaign experience." />
      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <Card title="Your history">
          {p.experiences.length === 0 ? (
            <EmptyState title="No experience added yet" />
          ) : (
            <ul className="divide-y divide-ink-100">
              {p.experiences.map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-4 py-3">
                  <div>
                    <p className="text-[15px] font-semibold text-ink-900">{e.title}{e.company ? ` · ${e.company}` : ""}</p>
                    <p className="text-[12.5px] text-ink-400">{fmtDate(e.startDate)} – {e.endDate ? fmtDate(e.endDate) : "Present"}{e.industry ? ` · ${e.industry}` : ""}{e.isCampaign ? ` · Campaign${e.campaignType ? `: ${e.campaignType}` : ""}` : ""}</p>
                    {e.description && <p className="mt-1 text-[13.5px] leading-relaxed text-ink-600">{e.description}</p>}
                  </div>
                  <form action={removeExperienceAction}>
                    <input type="hidden" name="experienceId" value={e.id} />
                    <button type="submit" aria-label="Remove" className="inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-400 hover:bg-ink-100 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Add a role">
          <ExperienceForm />
        </Card>
      </div>
    </>
  );
}
