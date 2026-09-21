import type { Metadata } from "next";
import Link from "next/link";
import { Check, Circle, ArrowRight } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { getOwnProfile, computeCompletion } from "@/server/services/agent.service";
import { PageHeader, Card, StatusBadge, Banner } from "@/components/app/ui";
import { SubmitProfile } from "@/components/profile/SubmitProfile";
import { labelFor } from "@/lib/options";

export const metadata: Metadata = { title: "My profile" };

export default async function ProfileOverviewPage() {
  const actor = await requireActor();
  const profile = await getOwnProfile(prisma, actor);
  const completion = computeCompletion(profile);
  const canSubmit = profile.status === "DRAFT" || profile.status === "REVISION_REQUIRED";
  const blockers = completion.parts.filter((p) => !p.done && (p.key === "resume" || p.key === "video"));

  return (
    <>
      <PageHeader eyebrow="My profile" title={profile.displayName} description={profile.headline ?? "Add a headline in the Professional section."} actions={<><StatusBadge status={profile.status} /><StatusBadge status={profile.verificationLevel} /></>} />

      {profile.status === "REVISION_REQUIRED" && <div className="mb-6"><Banner tone="warn" title="Changes requested by Hirewise">Update the sections mentioned in your notification, then submit again.</Banner></div>}

      <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <Card title={`Checklist · ${completion.total}% complete`} description="Submission needs 80% plus a résumé and a video introduction.">
          <ul className="divide-y divide-ink-100">
            {completion.parts.map((p) => (
              <li key={p.key} className="flex items-center justify-between gap-4 py-3">
                <span className="flex items-center gap-3 text-[14.5px]">
                  {p.done ? <Check className="h-4 w-4 text-brand-600" /> : <Circle className="h-4 w-4 text-ink-300" />}
                  <span className={p.done ? "text-ink-500" : "font-medium text-ink-800"}>{p.label}</span>
                  <span className="text-[12px] text-ink-400">{p.weight}%</span>
                </span>
                <Link href={p.href} className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand-600 hover:text-brand-700">
                  {p.done ? "Edit" : "Complete"} <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Submit for Hirewise review">
          <p className="text-[14px] leading-relaxed text-ink-600">
            {canSubmit
              ? "When you submit, a Hirewise recruiter reviews your profile, résumé, video, and voice samples. Only approved profiles are visible to clients."
              : `Your profile is ${labelFor(profile.status).toLowerCase()}. Edits you make now are saved, but a new review starts only if Hirewise requests changes.`}
          </p>
          {canSubmit && <SubmitProfile ready={completion.total >= 80 && blockers.length === 0} blockers={[...(completion.total < 80 ? [`reach 80% (currently ${completion.total}%)`] : []), ...blockers.map((b) => b.label.toLowerCase())]} />}
        </Card>
      </div>
    </>
  );
}
