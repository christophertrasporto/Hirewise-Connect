import type { Metadata } from "next";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { authorize, can } from "@/server/policies/authorize";
import { listSkillTags, listPathways, listTagRequests } from "@/server/services/skills.service";
import { listAllCoursesForStaff } from "@/server/services/academy.service";
import { Card, EmptyState, fmtDate } from "@/components/app/ui";
import { SkillTagForm, PathwayForm, TagRequestDecisionForm } from "@/components/academy/SkillTagForms";
import { labelFor, modeLabel } from "@/lib/options";

export const metadata: Metadata = { title: "Academy · Skill tags" };

/** Skills system: curated tags, their verification rules, pathways, and the request queue. */
export default async function StaffSkillTagsPage() {
  const actor = await requireActor();
  authorize(actor, "skills.manage");
  const [tags, pathways, open, decided, courses] = await Promise.all([
    listSkillTags(prisma, actor, false),
    listPathways(prisma, actor),
    listTagRequests(prisma, actor, "OPEN"),
    listTagRequests(prisma, actor).then((all) => all.filter((r) => r.status !== "OPEN").slice(-20).reverse()),
    can(actor, "course.manage") ? listAllCoursesForStaff(prisma, actor) : Promise.resolve([]),
  ]);
  const courseOpts = courses.filter((c) => c.status !== "ARCHIVED").map((c) => ({ id: c.id, title: c.title, status: c.status }));
  const categories = [...new Set(tags.map((t) => t.category))].sort();
  const byCategory = new Map<string, typeof tags>();
  for (const t of tags) byCategory.set(t.category, [...(byCategory.get(t.category) ?? []), t]);
  const tagOpts = tags.filter((t) => t.isActive).map((t) => ({ id: t.id, name: t.name, hashtag: t.hashtag }));

  return (
    <div className="space-y-5">
      <Card title={`Tag requests (${open.length})`} description="Talent asks for tags that are missing. Approve to create the tag (the requester gets it), merge into an existing tag, or reject with a reason.">
        {open.length === 0 ? <EmptyState title="No open requests" /> : (
          <ul className="divide-y divide-ink-100">
            {open.map((r) => (
              <li key={r.id} className="py-3">
                <p className="text-[14.5px] font-semibold text-ink-900">“{r.text}” <span className="text-[12.5px] font-normal text-ink-400">· {r.requestedBy} · {fmtDate(r.createdAt)}</span></p>
                <div className="mt-2"><TagRequestDecisionForm requestId={r.id} tags={tagOpts} categories={categories} /></div>
              </li>
            ))}
          </ul>
        )}
        {decided.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-[13px] font-semibold text-ink-600">Recent decisions ({decided.length})</summary>
            <ul className="mt-2 space-y-1 text-[13px] text-ink-600">{decided.map((r) => <li key={r.id}>“{r.text}” · {labelFor(r.status)}{r.createdSkill ? ` → ${r.createdSkill.name}` : ""}{r.mergedInto ? ` → ${r.mergedInto.name}` : ""}{r.note ? ` · ${r.note}` : ""} · {fmtDate(r.decidedAt)}</li>)}</ul>
          </details>
        )}
      </Card>

      <Card title={`Skill tags (${tags.length})`} description="Self-declared hashtags talent can pick. Verification is never set by hand: choose how a tag is earned and the platform recomputes the badge from completed training.">
        <div className="space-y-6">
          {[...byCategory.entries()].map(([category, items]) => (
            <div key={category}>
              <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-400">{category}</p>
              <div className="space-y-2">
                {items.map((t) => (
                  <details key={t.id} className="rounded-2xl border border-ink-100 p-4">
                    <summary className="cursor-pointer text-[14.5px] font-semibold text-ink-900">
                      {t.hashtag} <span className="font-normal text-ink-400">· {modeLabel(t.verificationMode)}{t.verificationMode === "REQUIRED_COURSE" && t.requiredCourse ? `: ${t.requiredCourse.title}` : ""}{t.verificationMode === "PATHWAY" && t.requiredPathway ? `: ${t.requiredPathway.title}` : ""}{t.verificationMode === "ANY_COURSE" ? `: ${t.courses.length} course(s)` : ""} · {t.holders} holder(s){!t.isActive ? " · inactive" : ""}</span>
                    </summary>
                    <div className="mt-4"><SkillTagForm t={t} courses={courseOpts} pathways={pathways.map((p) => ({ id: p.id, title: p.title }))} categories={categories} /></div>
                  </details>
                ))}
              </div>
            </div>
          ))}
          <details className="rounded-2xl border border-dashed border-ink-200 p-4">
            <summary className="cursor-pointer text-[14.5px] font-semibold text-brand-700">+ New tag</summary>
            <div className="mt-4"><SkillTagForm courses={courseOpts} pathways={pathways.map((p) => ({ id: p.id, title: p.title }))} categories={categories} /></div>
          </details>
        </div>
      </Card>

      <Card title={`Pathways (${pathways.length})`} description="An ordered set of courses. A tag in Pathway mode is verified when every required course in the pathway is passed.">
        <div className="space-y-3">
          {pathways.map((p) => (
            <details key={p.id} className="rounded-2xl border border-ink-100 p-4">
              <summary className="cursor-pointer text-[14.5px] font-semibold text-ink-900">{p.title} <span className="font-normal text-ink-400">· {p.courses.length} course(s) · used by {p.tagsUsing} tag(s){!p.isActive ? " · inactive" : ""}</span></summary>
              <div className="mt-4"><PathwayForm p={{ id: p.id, title: p.title, description: p.description, isActive: p.isActive, courses: p.courses.map((c) => ({ id: c.id, isRequired: c.isRequired })) }} courses={courseOpts} /></div>
            </details>
          ))}
          <details className="rounded-2xl border border-dashed border-ink-200 p-4">
            <summary className="cursor-pointer text-[14.5px] font-semibold text-brand-700">+ New pathway</summary>
            <div className="mt-4"><PathwayForm courses={courseOpts} /></div>
          </details>
        </div>
      </Card>
    </div>
  );
}
