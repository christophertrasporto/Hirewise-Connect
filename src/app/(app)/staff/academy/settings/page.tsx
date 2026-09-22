import type { Metadata } from "next";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { authorize } from "@/server/policies/authorize";
import { listTemplates } from "@/server/services/certification.service";
import { listLabels } from "@/server/services/assessment.service";
import { getRequirements, LEVELS } from "@/server/services/verification.service";
import { Card } from "@/components/app/ui";
import { TemplateForm, LabelForm, RequirementForm } from "@/components/academy/SettingsForms";
import { labelFor } from "@/lib/options";

export const metadata: Metadata = { title: "Academy · Settings" };

export default async function StaffAcademySettingsPage() {
  const actor = await requireActor();
  authorize(actor, "verification.manage");
  const [templates, labels, requirements] = await Promise.all([listTemplates(prisma), listLabels(prisma), getRequirements(prisma, actor)]);

  return (
    <div className="space-y-5">
      <Card title="Verification ladder" description="Each level requires its own rules plus every level below it. Recomputed automatically after approvals, media reviews, assessments, and certification changes. Manual overrides survive until the next recompute.">
        <ul className="divide-y divide-ink-100">
          {LEVELS.map((level) => (
            <li key={level} className="py-3">
              <p className="mb-1.5 text-[13.5px] font-bold text-ink-900">{labelFor(level)}</p>
              <RequirementForm level={level} rules={requirements[level]} />
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Certification templates" description="Rules evaluated when a course is completed or a coach finalises an assessment.">
        <div className="space-y-6">
          {templates.map((t) => (
            <details key={t.id} className="rounded-2xl border border-ink-100 p-4" open={false}>
              <summary className="cursor-pointer text-[14.5px] font-semibold text-ink-900">{t.name} <span className="font-normal text-ink-400">· {t.validityMonths ? `${t.validityMonths} months` : "no expiry"} · {t.requiresCoachReview ? "coach review" : "exam only"}{!t.isActive ? " · inactive" : ""}</span></summary>
              <div className="mt-4"><TemplateForm t={t} /></div>
            </details>
          ))}
          <details className="rounded-2xl border border-dashed border-ink-200 p-4">
            <summary className="cursor-pointer text-[14.5px] font-semibold text-brand-700">+ New template</summary>
            <div className="mt-4"><TemplateForm /></div>
          </details>
        </div>
      </Card>
      <Card title="Assessment result labels" description="Configurable outcome scale for coach assessments. Higher rank = better. Rank 0 labels count as not assessed.">
        <div className="space-y-2">
          {labels.map((l) => <LabelForm key={l.id} l={{ key: l.key, label: l.label, rank: l.rank, isActive: l.isActive }} />)}
          <div className="pt-2"><LabelForm /></div>
        </div>
      </Card>
    </div>
  );
}
